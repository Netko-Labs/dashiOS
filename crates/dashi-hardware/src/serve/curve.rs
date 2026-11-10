//! The Curve Optimizer's confirm-or-revert flow: apply now, hold the change
//! as pending, and keep it when `ConfirmTuning` arrives.

use std::sync::Arc;

use zbus::fdo;

use super::convert::to_fdo;
use super::{Pending, Shared, countdown};

/// Apply an offset now and arm the revert countdown; returns the
/// confirmation token.
pub(super) fn apply_pending(
    shared: &Arc<Shared>,
    all_core: i32,
    per_core: &[i32],
    confirm_within: u32,
) -> fdo::Result<String> {
    let pairs: Vec<(u32, i32)> = per_core
        .iter()
        .enumerate()
        .map(|(core, offset)| (core as u32, *offset))
        .collect();
    shared
        .machine
        .lock()
        .expect("the machine lock is never poisoned")
        .apply_curve_optimizer(if pairs.is_empty() { all_core } else { 0 }, &pairs)
        .map_err(to_fdo)?;
    let token = countdown::new_token();
    let all_core = (pairs.is_empty()).then_some(all_core);
    if let Ok(mut pending) = shared.pending.lock() {
        pending.insert(
            token.clone(),
            Pending {
                all_core,
                per_core: pairs,
            },
        );
    }
    countdown::arm(Arc::clone(shared), token.clone(), confirm_within);
    Ok(token)
}

/// Keep the pending change `token` names, saving it for the boot guard.
pub(super) fn confirm(shared: &Shared, token: &str) -> fdo::Result<()> {
    let pending = shared
        .pending
        .lock()
        .ok()
        .and_then(|mut p| p.remove(token))
        .ok_or_else(|| fdo::Error::InvalidArgs("no such token (it may have timed out)".into()))?;
    let machine = shared
        .machine
        .lock()
        .expect("the machine lock is never poisoned");
    let tuning = machine.tuning_snapshot(pending.all_core, &pending.per_core);
    machine
        .state()
        .save_tuning(&tuning)
        .map_err(|e| fdo::Error::Failed(e.to_string()))
}
