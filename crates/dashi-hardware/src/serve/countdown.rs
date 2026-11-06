//! The tuning countdown: a Curve Optimizer change set with `confirmWithin`
//! seconds reverts to 0 unless `ConfirmTuning(token)` arrives in time, so a
//! value that freezes the machine can't outlive a wedged session.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use super::Shared;

static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

pub(crate) fn new_token() -> String {
    format!("co-{}", NEXT_TOKEN.fetch_add(1, Ordering::Relaxed))
}

/// After `seconds`, if `token` is still pending (not confirmed or cleared),
/// put the Curve Optimizer back to 0.
pub(crate) fn arm(shared: Arc<Shared>, token: String, seconds: u32) {
    if seconds == 0 {
        return;
    }
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(u64::from(seconds)));
        let still_pending = shared
            .pending
            .lock()
            .map(|mut pending| pending.remove(&token).is_some())
            .unwrap_or(false);
        if still_pending && let Ok(machine) = shared.machine.lock() {
            // Back to a safe offset; ignore the result (the machine may be
            // on its way down, or the SMU may already have forgotten it).
            let _ = machine.apply_curve_optimizer(0, &[]);
        }
    });
}
