//! Fetching, from the service's side: it starts `dashi-voice fetch` as a
//! process of its own, reads its progress a line at a time and tells the
//! subscribers. The fetcher is the only part of Voice that reaches the
//! network, and it never sees sound; under systemd it runs as a unit of its
//! own (`systemd-run`), outside the service's sandbox, which has no network.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{Value, json};

use super::Service;
use crate::protocol::Event;

/// The transient unit the fetcher runs as under systemd.
pub(crate) const UNIT: &str = "dashi-voice-fetch.service";

/// A line of the fetcher's output (models/fetch.rs, cli.rs).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    #[serde(default)]
    set: Option<String>,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    received: u64,
    #[serde(default)]
    bytes: u64,
    #[serde(default)]
    done: bool,
    #[serde(default)]
    error: Option<String>,
}

pub(super) struct Fetching {
    /// The program and its first arguments.
    fetcher: Vec<String>,
    child: Mutex<Option<Arc<Mutex<Child>>>>,
}

impl Fetching {
    pub(super) fn new(fetcher: Vec<String>) -> Self {
        Self {
            fetcher,
            child: Mutex::new(None),
        }
    }

    pub(super) fn running(&self) -> bool {
        self.child.lock().is_ok_and(|child| child.is_some())
    }

    pub(super) fn cancel(&self) {
        let Some(child) = self.child.lock().ok().and_then(|child| child.clone()) else {
            return;
        };
        // Under systemd the fetcher is a unit of its own: stopping the unit ends it and its curl.
        if self.fetcher.first().map(String::as_str) == Some("systemd-run") {
            let _ = Command::new("systemctl")
                .args(["--user", "stop", UNIT])
                .status();
        }
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
        }
    }
}

impl Service {
    pub(super) fn fetch(self: &Arc<Self>, asked: Option<Vec<String>>) -> Result<Value, String> {
        let sets = Self::sets(asked, false)?;
        let bytes: u64 = sets
            .iter()
            .map(|set| set.bytes() - self.store.have(set))
            .sum();
        if sets.iter().all(|set| self.store.installed(set)) {
            return Ok(json!({ "bytes": 0, "fetching": false }));
        }
        let mut slot = self
            .fetching
            .child
            .lock()
            .map_err(|_| "Voice is not well.")?;
        if slot.is_some() {
            return Err("Models are already being fetched.".into());
        }
        let (program, first) = self
            .fetching
            .fetcher
            .split_first()
            .ok_or("Voice has no way to fetch models.")?;
        let mut child = Command::new(program)
            .args(first)
            .args(sets.iter().map(|set| set.id))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|error| format!("The fetch could not start: {error}"))?;
        let output = child.stdout.take().ok_or("The fetch could not start.")?;
        let child = Arc::new(Mutex::new(child));
        *slot = Some(child.clone());
        drop(slot);
        let service = self.clone();
        std::thread::spawn(move || service.follow(output, &child));
        Ok(json!({ "bytes": bytes, "fetching": true }))
    }

    /// Read the fetcher to its end, telling the subscribers how far it is.
    fn follow(&self, output: impl std::io::Read, child: &Mutex<Child>) {
        let mut last = Line {
            set: None,
            file: None,
            received: 0,
            bytes: 0,
            done: false,
            error: None,
        };
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            let Ok(line) = serde_json::from_str::<Line>(&line) else {
                continue;
            };
            if line.done {
                last.done = true;
                last.error = line.error;
                break;
            }
            self.hub.emit(&Event::Fetch {
                set: line.set.clone(),
                file: line.file.clone(),
                received: line.received,
                bytes: line.bytes,
                done: false,
                error: None,
            });
            last = line;
        }
        if let Ok(mut child) = child.lock() {
            let _ = child.wait();
        }
        if let Ok(mut slot) = self.fetching.child.lock() {
            *slot = None;
        }
        // A fetcher that went without a last word was stopped, or fell over.
        let error = if last.done {
            last.error
        } else {
            Some("The fetch stopped before it was done.".into())
        };
        self.hub.emit(&Event::Fetch {
            set: None,
            file: None,
            received: last.received,
            bytes: last.bytes,
            done: true,
            error,
        });
        self.hub.emit(&Event::Models {});
    }
}
