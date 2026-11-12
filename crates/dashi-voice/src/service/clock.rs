//! Time, as the service reads it: the real clock, or a test's, which moves
//! only when something sleeps.

use std::time::{Duration, Instant};

pub(crate) trait Clock: Send + Sync {
    /// Time since the clock was made.
    fn now(&self) -> Duration;
    fn sleep(&self, time: Duration);
}

pub(crate) struct Real(Instant);

impl Default for Real {
    fn default() -> Self {
        Self(Instant::now())
    }
}

impl Clock for Real {
    fn now(&self) -> Duration {
        self.0.elapsed()
    }

    fn sleep(&self, time: Duration) {
        std::thread::sleep(time);
    }
}
