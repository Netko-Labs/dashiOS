//! Asking the person, from inside dashi-secretd: a passkey's use (and a
//! payment) waits here until the person answers. The shell watches
//! (`watch-approvals`) and puts up the sheet; the answer counts only if it
//! proves the person is there: the login password (checked here against the
//! vault, `approve {id, password}`) or a fingerprint dashi-secretd itself
//! verified through fprintd (fprint.rs). A "no" needs no proof.

use std::{
    collections::HashMap,
    io::Write,
    os::unix::net::UnixStream,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

/// How long a question waits for the person.
pub const WAIT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Waiting,
    Yes,
    No,
}

struct Pending {
    uid: u32,
    outcome: Outcome,
}

struct State {
    next: u64,
    pending: HashMap<u64, Pending>,
    /// The shell's connection for each person, events written to it.
    watchers: HashMap<u32, Arc<Mutex<UnixStream>>>,
}

pub struct Approvals {
    state: Mutex<State>,
    changed: Condvar,
}

impl Default for Approvals {
    fn default() -> Self {
        Self {
            state: Mutex::new(State {
                next: 0,
                pending: HashMap::new(),
                watchers: HashMap::new(),
            }),
            changed: Condvar::new(),
        }
    }
}

fn send(stream: &Mutex<UnixStream>, event: &Value) -> bool {
    let mut line = event.to_string();
    line.push('\n');
    stream
        .lock()
        .is_ok_and(|mut s| s.write_all(line.as_bytes()).is_ok())
}

impl Approvals {
    /// The shell of `uid` will put up the questions.
    pub fn watch(&self, uid: u32, stream: Arc<Mutex<UnixStream>>) {
        if let Ok(mut state) = self.state.lock() {
            state.watchers.insert(uid, stream);
        }
    }

    /// Whose shell is watching (the person at the screen), if anyone's.
    pub fn watching(&self) -> Option<u32> {
        let state = self.state.lock().ok()?;
        let mut uids: Vec<u32> = state.watchers.keys().copied().collect();
        uids.sort_unstable();
        (uids.len() == 1).then(|| uids[0])
    }

    /// Ask `uid`'s person about `what` (`{kind, rp, user, …}`); true only on a proven yes in time.
    /// `verify` runs alongside (the fingerprint reader) and answers yes itself when it succeeds.
    pub fn ask(&self, uid: u32, what: Value, verify: impl FnOnce(u64) + Send + 'static) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        let Some(watcher) = state.watchers.get(&uid).cloned() else {
            return false;
        };
        state.next += 1;
        let id = state.next;
        state.pending.insert(
            id,
            Pending {
                uid,
                outcome: Outcome::Waiting,
            },
        );
        drop(state);
        let mut event = json!({ "event": "approve", "id": id });
        if let (Value::Object(target), Value::Object(fields)) = (&mut event, what) {
            target.extend(fields);
        }
        if !send(&watcher, &event) {
            self.forget(uid, id);
            return false;
        }
        std::thread::spawn(move || verify(id));
        let deadline = Instant::now() + WAIT;
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        loop {
            let outcome = state
                .pending
                .get(&id)
                .map(|p| p.outcome)
                .unwrap_or(Outcome::No);
            if outcome != Outcome::Waiting {
                state.pending.remove(&id);
                drop(state);
                let _ = send(&watcher, &json!({ "event": "answered", "id": id }));
                return outcome == Outcome::Yes;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                state.pending.remove(&id);
                drop(state);
                let _ = send(&watcher, &json!({ "event": "answered", "id": id }));
                return false;
            }
            state = match self.changed.wait_timeout(state, left) {
                Ok((state, _)) => state,
                Err(_) => return false,
            };
        }
    }

    /// The answer to question `id`, from `uid` (anyone else's is ignored). Callers prove a yes first.
    pub fn answer(&self, uid: u32, id: u64, yes: bool) -> bool {
        let Ok(mut state) = self.state.lock() else {
            return false;
        };
        let Some(pending) = state
            .pending
            .get_mut(&id)
            .filter(|p| p.uid == uid && p.outcome == Outcome::Waiting)
        else {
            return false;
        };
        pending.outcome = if yes { Outcome::Yes } else { Outcome::No };
        self.changed.notify_all();
        true
    }

    /// Whether question `id` is `uid`'s and still open.
    pub fn is_open(&self, uid: u32, id: u64) -> bool {
        self.state.lock().is_ok_and(|s| {
            s.pending
                .get(&id)
                .is_some_and(|p| p.uid == uid && p.outcome == Outcome::Waiting)
        })
    }

    fn forget(&self, uid: u32, id: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.pending.remove(&id);
            state.watchers.remove(&uid);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader};

    use super::*;

    #[test]
    fn a_question_waits_for_its_owners_answer() {
        let approvals = Arc::new(Approvals::default());
        let (shell, ours) = UnixStream::pair().unwrap();
        approvals.watch(1000, Arc::new(Mutex::new(ours)));
        assert_eq!(approvals.watching(), Some(1000));
        let asking = {
            let approvals = approvals.clone();
            std::thread::spawn(move || {
                approvals.ask(
                    1000,
                    json!({ "kind": "sign-in", "rp": "signin.localhost" }),
                    |_| {},
                )
            })
        };
        let mut lines = BufReader::new(shell);
        let mut line = String::new();
        lines.read_line(&mut line).unwrap();
        let event: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(event["rp"], "signin.localhost");
        let id = event["id"].as_u64().unwrap();
        // Another person's answer is ignored; the owner's counts.
        assert!(!approvals.answer(1001, id, true));
        assert!(approvals.is_open(1000, id));
        assert!(approvals.answer(1000, id, true));
        assert!(asking.join().unwrap());
        assert!(!approvals.answer(1000, id, true));
    }

    #[test]
    fn nobody_watching_is_a_no() {
        let approvals = Approvals::default();
        assert!(!approvals.ask(1000, json!({}), |_| {}));
        assert_eq!(approvals.watching(), None);
    }
}
