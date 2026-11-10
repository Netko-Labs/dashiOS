//! The probe before a GPU that does not draw is opened. Opening it through
//! the seat (logind's TakeDevice), then DRM, GBM and EGL on it, happens on
//! the event loop; on a card that fell off the bus the first of those hangs
//! in the driver and the whole session with it. So a thread opens the card's
//! node first (and closes it): if that answers, so will the seat's open; if
//! it does not answer in `PROBE_DEADLINE`, the card is stuck and nothing
//! touches it until the thread comes back. A refusal (cardwire blocks the
//! card in Integrated mode, or it is gone) leaves it asleep; with a screen
//! connected it is tried again, less and less often, so the screen lights up
//! once the shell switches to Hybrid.

use crate::ipc::protocol::Event;
use std::{
    fs::OpenOptions,
    io,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::{Duration, Instant},
};

use smithay::reexports::calloop::channel::{self, Sender};

use super::holds::{DRM_SYSFS, Sysfs, sysfs_screens};
use super::lifecycle::{Answer, PROBE_DEADLINE, Phase, Probe, Want};
use super::sleep::settle;
use super::*;

/// A probe's answer, from its thread.
pub(super) struct ProbeAnswer {
    node: DrmNode,
    id: u64,
    result: io::Result<()>,
}

/// The channel probes answer on, heard on the event loop.
pub(super) fn probes(
    handle: &LoopHandle<'static, Dashi>,
) -> Result<Sender<ProbeAnswer>, Box<dyn std::error::Error>> {
    let (sender, receiver) = channel::channel::<ProbeAnswer>();
    handle
        .insert_source(receiver, |event, _, state| {
            if let channel::Event::Msg(answer) = event {
                answered(state, answer);
            }
        })
        .map_err(|error| error.error)?;
    Ok(sender)
}

/// Something needs a sleeping GPU open: probe it (once, however many ask),
/// and open it when the probe answers. Not while the session is on another
/// VT (the seat would refuse it; `session_active` looks again).
pub(super) fn wake(state: &mut Dashi, node: DrmNode, why: &str) {
    let now = Instant::now();
    let step = with_udev(state, |_, data| {
        if !data.session.is_active() {
            return None;
        }
        let sender = data.probes.clone();
        let card = data.cards.get_mut(&node)?;
        let want = card.life.want(now);
        Some((want, card.path.clone(), card.name.clone(), sender))
    })
    .flatten();
    let Some((want, path, name, sender)) = step else {
        return;
    };
    let Want::Probe { id, deadline } = want else {
        if want == Want::Stuck {
            tracing::debug!(card = name, why, "not waking a GPU that does not answer");
        }
        return;
    };
    tracing::info!(card = name, why, "waking a GPU: probing it first");
    let spawned = std::thread::Builder::new()
        .name("dashi-gpu-probe".into())
        .spawn(move || {
            let result = open_and_close(&path);
            // The loop may be gone (dashi-comp exiting): nothing to tell.
            let _ = sender.send(ProbeAnswer { node, id, result });
        });
    if let Err(error) = spawned {
        answered(
            state,
            ProbeAnswer {
                node,
                id,
                result: Err(error),
            },
        );
        return;
    }
    let _ = state
        .loop_handle
        .insert_source(Timer::from_deadline(deadline), move |_, _, state| {
            missed(state, node, id);
            TimeoutAction::Drop
        });
}

/// Open a card's node as the seat would (read-write, no controlling
/// terminal, non-blocking) and close it again. This is the call that hangs
/// on a card that fell off the bus; it runs on a probe's thread only.
fn open_and_close(path: &Path) -> io::Result<()> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOCTTY | libc::O_NONBLOCK)
        .open(path)
        .map(drop)
}

/// A probe came back.
fn answered(state: &mut Dashi, answer: ProbeAnswer) {
    let ProbeAnswer { node, id, result } = answer;
    let now = Instant::now();
    let refusal = result.err().map(|error| error.to_string());
    let probe = match refusal {
        None => Probe::Opened,
        Some(_) => Probe::Refused,
    };
    let step = with_udev(state, |_, data| {
        let card = data.cards.get_mut(&node)?;
        Some((
            card.life.answered(id, probe, now),
            card.path.clone(),
            card.name.clone(),
        ))
    })
    .flatten();
    // None: udev removed the card meanwhile.
    if let Some((step, path, name)) = step {
        match step {
            Answer::Open => match device_added(state, node, &path) {
                Ok(()) => {
                    tracing::info!(card = name, "a GPU woke");
                    with_udev(state, |_, data| {
                        if let Some(card) = data.cards.get_mut(&node) {
                            card.life.reset_retry();
                        }
                    });
                    state.ipc.emit(Event::GpusChanged);
                    settle(state, node);
                }
                Err(error) => {
                    tracing::warn!(card = name, %error, "a GPU answered but did not open");
                    with_udev(state, |_, data| {
                        if let Some(card) = data.cards.get_mut(&node) {
                            card.life.open_failed(now);
                        }
                    });
                    retry_if_screen(state, node);
                }
            },
            Answer::Refused => {
                let error = refusal.as_deref().unwrap_or_default();
                tracing::info!(
                    card = name,
                    error,
                    "a GPU would not open (cardwire blocks it, or it is gone); left asleep"
                );
                retry_if_screen(state, node);
            }
            Answer::Recovered => {
                tracing::warn!(card = name, "a GPU that did not answer answers again");
                state.ipc.emit(Event::GpusChanged);
                super::sleep::gpu_changed(state, node);
            }
            Answer::Stale => {}
        }
    }
    super::imports::answer_waiting(state);
}

/// A probe's deadline passed: if it is still out, the card is stuck.
fn missed(state: &mut Dashi, node: DrmNode, id: u64) {
    let now = Instant::now();
    let stuck = with_udev(state, |_, data| {
        let card = data.cards.get_mut(&node)?;
        card.life.deadline(id, now).then(|| card.name.clone())
    })
    .flatten();
    let Some(name) = stuck else { return };
    tracing::warn!(
        card = name,
        seconds = PROBE_DEADLINE.as_secs(),
        "a GPU did not answer its probe: left alone until it does (it may have fallen off the bus)"
    );
    state.ipc.emit(Event::GpusChanged);
    super::imports::answer_waiting(state);
}

/// A card that would not open while sysfs says a screen is on it: try again
/// later (one timer at a time), and tell the shell, which may switch modes.
fn retry_if_screen(state: &mut Dashi, node: DrmNode) {
    let wait = with_udev(state, |_, data| {
        let card = data.cards.get_mut(&node)?;
        let screen = sysfs_screens(Path::new(DRM_SYSFS), &card.name) == Sysfs::Connected;
        if !screen || card.retrying {
            return None;
        }
        card.retrying = true;
        Some(card.life.next_retry())
    })
    .flatten();
    let Some(wait) = wait else { return };
    state.ipc.emit(Event::GpusChanged);
    let _ = state
        .loop_handle
        .insert_source(Timer::from_duration(wait), move |_, _, state| {
            retry(state, node, wait);
            TimeoutAction::Drop
        });
}

fn retry(state: &mut Dashi, node: DrmNode, waited: Duration) {
    let again = with_udev(state, |_, data| {
        let card = data.cards.get_mut(&node)?;
        card.retrying = false;
        let asleep = matches!(card.life.phase(), Phase::Asleep { .. });
        Some(asleep && sysfs_screens(Path::new(DRM_SYSFS), &card.name) == Sysfs::Connected)
    })
    .flatten();
    if again == Some(true) {
        tracing::debug!(after = ?waited, "trying a GPU with a screen again");
        wake(state, node, "a screen is connected to it");
    }
}
