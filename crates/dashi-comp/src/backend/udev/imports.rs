//! Client buffers (linux-dmabuf). One the open GPUs cannot read wakes the
//! sleeping ones (a game on the graphics card handing over a buffer only it
//! reads), which then stay open while such buffers live. Waking is a probe
//! and an opening (probe.rs), so the import is answered when they are done,
//! not at once: the client's buffer waits, the event loop does not.

use std::time::Instant;

use smithay::wayland::dmabuf::ImportNotifier;

use super::lifecycle::{Phase, may_wake_for_buffer};
use super::probe::wake;
use super::sleep::settle;
use super::*;

/// Import a client's buffer and answer its notifier, now or once the
/// sleeping GPUs woken for it have answered.
pub(crate) fn import_dmabuf(state: &mut Dashi, dmabuf: Dmabuf, notifier: ImportNotifier) {
    match with_udev(state, |_, data| data.import_dmabuf(&dmabuf)) {
        Some(true) => {
            let _ = notifier.successful::<Dashi>();
            return;
        }
        Some(false) => {}
        None => {
            notifier.failed();
            return;
        }
    }
    let sleeping: Vec<DrmNode> = with_udev(state, |_, data| {
        let since_failed = data.buffer_wake_failed.map(|at| at.elapsed());
        if !may_wake_for_buffer(since_failed) {
            return Vec::new();
        }
        data.cards
            .iter()
            .filter(|(_, card)| matches!(card.life.phase(), Phase::Asleep { .. }))
            .map(|(node, _)| *node)
            .collect()
    })
    .unwrap_or_default();
    for node in &sleeping {
        wake(state, *node, "a client's buffer only it may read");
    }
    let wait = with_udev(state, |_, data| {
        let probing = data.cards.values().any(|card| card.life.is_probing());
        if probing {
            data.waiting.push((dmabuf, notifier));
            None
        } else {
            if !sleeping.is_empty() {
                data.buffer_wake_failed = Some(Instant::now());
            }
            Some(notifier)
        }
    });
    if let Some(Some(notifier)) = wait {
        notifier.failed();
    }
}

/// Once no probe is out: import the buffers that waited for one, and let
/// the GPUs woken for them settle (they stay while the buffers live).
pub(super) fn answer_waiting(state: &mut Dashi) {
    let ready = with_udev(state, |_, data| {
        if data.cards.values().any(|card| card.life.is_probing()) {
            Vec::new()
        } else {
            std::mem::take(&mut data.waiting)
        }
    })
    .unwrap_or_default();
    if ready.is_empty() {
        return;
    }
    for (dmabuf, notifier) in ready {
        let imported = with_udev(state, |_, data| {
            let imported = data.import_dmabuf(&dmabuf);
            data.buffer_wake_failed = (!imported).then(Instant::now);
            imported
        })
        .unwrap_or(false);
        if imported {
            let _ = notifier.successful::<Dashi>();
        } else {
            notifier.failed();
        }
    }
    let open: Vec<DrmNode> = with_udev(state, |_, data| {
        data.cards
            .iter()
            .filter(|(_, card)| card.life.is_open())
            .map(|(node, _)| *node)
            .collect()
    })
    .unwrap_or_default();
    for node in open {
        settle(state, node);
    }
}
