//! The graphics card sleeps. A GPU that does not draw (a laptop's NVIDIA
//! card beside the GPU that drives its panel) is held open only while
//! something needs it: a screen connected to it, a client's buffer only it
//! can read, or the shell keeping it warm (`gpu-keep`). When nothing does,
//! after a grace, its renderer, EGL display, GBM device and DRM fd all go
//! (the driver's /dev/nvidia* with them), so it can runtime-suspend.
//!
//! Asleep, it is only a path: udev still says when its connectors change (a
//! uevent, no device opened), and the connectors' sysfs `status` (the
//! kernel's last probe, read without waking the card) says whether a screen
//! is there. Clients never hear of it: dmabuf feedback names the drawing GPU.
//!
//! Every opening is probed first, off the event loop (probe.rs); a card udev
//! says is gone while open is let go off the event loop (gone.rs): this
//! laptop's card falls off the bus, and then every call on it hangs in the
//! driver. The rules are lifecycle.rs's; this file carries them out.

use crate::ipc::protocol::Event;
use std::{
    path::{Path, PathBuf},
    time::Instant,
};

use super::gone::abandon;
use super::holds::{DRM_SYSFS, Sysfs, card_name, sysfs_screens};
use super::lifecycle::{Grace, Life, Phase};
use super::probe::wake;
use super::*;

/// A GPU that does not draw, open or asleep.
pub(super) struct Card {
    /// Its device node (`/dev/dri/card1`) and udev's name for it (`card1`).
    pub(super) path: PathBuf,
    pub(super) name: String,
    pub(super) life: Life,
    /// A retry timer is set (probe.rs): a screen is there and it would not open.
    pub(super) retrying: bool,
}

/// A GPU udev lists (at start, or plugged in later). The one that draws is
/// opened at once; any other starts asleep and is woken (probed, then opened)
/// if the shell keeps it or sysfs says a screen is connected (or never
/// probed one: opening it probes, and it sleeps after if nothing is there).
pub(super) fn gpu_found(
    state: &mut Dashi,
    node: DrmNode,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let name = card_name(path).unwrap_or_else(|| node.to_string());
    let (known, draws) = with_udev(state, |_, data| {
        (
            data.devices.contains_key(&node) || data.cards.contains_key(&node),
            is_drawing_gpu(node, data.primary_gpu),
        )
    })
    .ok_or("the udev backend is gone")?;
    if known {
        return Ok(());
    }
    if draws {
        device_added(state, node, path)?;
        state.ipc.emit(Event::GpusChanged);
        return Ok(());
    }
    let wanted = with_udev(state, |_, data| {
        let wanted = data.kept.contains(&name)
            || sysfs_screens(Path::new(DRM_SYSFS), &name) != Sysfs::Disconnected;
        data.cards.insert(
            node,
            Card {
                path: path.to_owned(),
                name: name.clone(),
                life: Life::asleep(None),
                retrying: false,
            },
        );
        wanted
    })
    .unwrap_or(false);
    if wanted {
        wake(state, node, "found with a screen, or kept");
    } else {
        tracing::info!(
            card = name,
            "a GPU with no screen: left asleep until one is connected"
        );
    }
    state.ipc.emit(Event::GpusChanged);
    Ok(())
}

/// udev says a GPU changed (a connector, usually): an open one is scanned
/// and may go to sleep after; a sleeping one is woken if a screen may be there.
pub(super) fn gpu_changed(state: &mut Dashi, node: DrmNode) {
    let now = Instant::now();
    let look = with_udev(state, |_, data| {
        if data.devices.contains_key(&node) {
            return Some(None);
        }
        let card = data.cards.get(&node)?;
        let connected = sysfs_screens(Path::new(DRM_SYSFS), &card.name) == Sysfs::Connected;
        Some(Some(card.life.look_on_change(connected, now)))
    })
    .flatten();
    match look {
        Some(None) => {
            scan_connectors(state, node);
            settle(state, node);
        }
        Some(Some(true)) => wake(state, node, "its connectors changed"),
        Some(Some(false)) | None => {}
    }
}

/// udev says a GPU is gone. Asleep (or stuck), it is forgotten; open, it is
/// abandoned: its screens leave, its device is never touched again.
pub(super) fn gpu_gone(state: &mut Dashi, node: DrmNode) {
    let (card, open) = with_udev(state, |_, data| {
        (data.cards.remove(&node), data.devices.contains_key(&node))
    })
    .unwrap_or((None, false));
    match (card, open) {
        (Some(card), true) => abandon(state, node, &card.name),
        (None, true) => device_removed(state, node),
        (Some(card), false) => {
            tracing::info!(card = card.name, "a sleeping GPU is gone");
            state.ipc.emit(Event::GpusChanged);
        }
        (None, false) => {}
    }
    super::imports::answer_waiting(state);
}

/// Back on our VT: a screen may have been plugged into a sleeping GPU
/// meanwhile, or the shell kept one while the seat was away.
pub(super) fn session_active(state: &mut Dashi) {
    let wanted: Vec<DrmNode> = with_udev(state, |_, data| {
        data.cards
            .iter()
            .filter(|(_, card)| matches!(card.life.phase(), Phase::Asleep { .. }))
            .filter(|(_, card)| {
                data.kept.contains(&card.name)
                    || sysfs_screens(Path::new(DRM_SYSFS), &card.name) == Sysfs::Connected
            })
            .map(|(node, _)| *node)
            .collect()
    })
    .unwrap_or_default();
    for node in wanted {
        wake(
            state,
            node,
            "a screen was connected while away, or it is kept",
        );
    }
}

/// If nothing but client buffers (or nothing at all) holds `node`, put it to
/// sleep after the grace. The GPU that draws has no card here: always open.
pub(super) fn settle(state: &mut Dashi, node: DrmNode) {
    let now = Instant::now();
    let at = with_udev(state, |_, data| {
        let holds = data.holds(node)?;
        data.cards.get_mut(&node)?.life.settle(holds, now)
    })
    .flatten();
    let Some(mut at) = at else { return };
    let _ = state
        .loop_handle
        .insert_source(Timer::from_deadline(at), move |_, _, state| {
            let now = Instant::now();
            let grace = with_udev(state, |_, data| {
                let holds = data.holds(node)?;
                Some(data.cards.get_mut(&node)?.life.grace_due(holds, at, now))
            })
            .flatten();
            match grace {
                Some(Grace::Sleep) => {
                    release(state, node);
                    TimeoutAction::Drop
                }
                Some(Grace::Again(next)) => {
                    at = next;
                    TimeoutAction::ToInstant(next)
                }
                Some(Grace::Done) | None => TimeoutAction::Drop,
            }
        });
}

/// Let a GPU go: its renderer and EGL display, its GBM device, its DRM fd
/// (handed back to the seat), so its driver can suspend it. A card whose
/// sysfs entry is gone fell off the bus before udev said so: abandoned.
fn release(state: &mut Dashi, node: DrmNode) {
    let Some(name) = with_udev(state, |_, data| {
        data.cards.get(&node).map(|card| card.name.clone())
    })
    .flatten() else {
        return;
    };
    if !Path::new(DRM_SYSFS).join(&name).exists() {
        abandon(state, node, &name);
        return;
    }
    let device = with_udev(state, |_, data| {
        let device = data.devices.remove(&node)?;
        if let Some(render_node) = device.render_node {
            data.gpus.as_mut().remove_node(&render_node);
            // Enumerating now drops its renderer and EGL context, not at the next frame.
            if let Err(error) = data.gpus.devices().map(|_| ()) {
                tracing::warn!(?error, "listing the GPUs left");
            }
        }
        Some(device)
    })
    .flatten();
    let Some(device) = device else { return };
    let fd = device.fd.clone();
    state.loop_handle.remove(device.token);
    drop(device);
    tracing::info!(card = name, "a GPU nothing needs: let go, so it can sleep");
    with_udev(state, |_, data| {
        let owned: Result<OwnedFd, DeviceFd> = fd.try_into();
        match owned {
            Ok(fd) => {
                if let Err(error) = data.session.close(fd) {
                    tracing::warn!(%error, "handing a GPU back to the seat");
                }
            }
            Err(_) => tracing::warn!("a GPU's fd is still held; it closes when that lets go"),
        }
    });
    state.ipc.emit(Event::GpusChanged);
}

/// `gpu-keep {card, on}`: hold a GPU open with nothing on it (warm for a
/// game), or stop; it sleeps after the grace if nothing else holds it.
pub(crate) fn keep_gpu(state: &mut Dashi, card: &str, on: bool) -> Result<(), String> {
    let node = with_udev(state, |_, data| {
        let node = data.node_of(card)?;
        if on {
            data.kept.insert(card.to_owned());
        } else {
            data.kept.remove(card);
        }
        Some(node)
    })
    .flatten()
    .ok_or_else(|| format!("no GPU named {card}"))?;
    if on {
        wake(state, node, "the shell keeps it");
    } else {
        settle(state, node);
    }
    state.ipc.emit(Event::GpusChanged);
    Ok(())
}
