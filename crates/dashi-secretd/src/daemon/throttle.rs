//! Wrong passwords are slowed down: a few free tries, then a wait.

use std::time::{Duration, Instant};

use super::Daemon;

/// After this many wrong passwords in a row, each try waits LOCKOUT.
pub(super) const FREE_TRIES: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(30);

impl Daemon {
    /// Too many wrong passwords lately: wait.
    pub(super) fn throttle(&self, uid: u32) -> Result<(), String> {
        match self.failures.get(&uid) {
            Some((count, last)) if *count >= FREE_TRIES && last.elapsed() < LOCKOUT => {
                Err("too many wrong passwords; try again in a moment".into())
            }
            _ => Ok(()),
        }
    }

    pub(super) fn count<T>(&mut self, uid: u32, result: Result<T, String>) -> Result<T, String> {
        match &result {
            Ok(_) => {
                self.failures.remove(&uid);
            }
            Err(_) => {
                let entry = self.failures.entry(uid).or_insert((0, Instant::now()));
                entry.0 += 1;
                entry.1 = Instant::now();
            }
        }
        result
    }
}
