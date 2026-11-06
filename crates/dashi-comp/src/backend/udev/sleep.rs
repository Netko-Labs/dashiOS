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

use std::{path::Path, time::Instant};

use super::holds::{
    Asleep, DRM_SYSFS, GRACE, Next, Sysfs, card_name, look_on_change, may_wake_for_buffer,
    sysfs_screens,
};
use super::*;

/// A GPU udev lists (at start, or plugged in later): opened if it draws, the
/// shell keeps it, or sysfs says a screen is connected (or never probed one:
/// opening it probes, and it sleeps after if nothing is there); else left asleep.
pub(super) fn gpu_found(
    state: &mut Dashi,
    node: DrmNode,
    path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let card = card_name(path).unwrap_or_else(|| node.to_string());
    let open = with_udev(state, |_, data| {
        is_drawing_gpu(node, data.primary_gpu)
            || data.kept.contains(&card)
            || sysfs_screens(Path::new(DRM_SYSFS), &card) != Sysfs::Disconnected
    })
    .ok_or("the udev backend is gone")?;
    if open {
        device_added(state, node, path)?;
        settle(state, node);
    } else {
        tracing::info!(
            card,
            "a GPU with no screen: left asleep until one is connected"
        );
        with_udev(state, |_, data| {
            data.asleep.insert(
                node,
                Asleep {
                    path: path.to_owned(),
                    card,
                    since: None,
                },
            );
        });
    }
    state.ipc.emit("gpus-changed", json!({}));
    Ok(())
}

/// udev says a GPU changed (a connector, usually): an open one is scanned
/// and may go to sleep after; a sleeping one is opened if a screen may be there.
pub(super) fn gpu_changed(state: &mut Dashi, node: DrmNode) {
    let look = with_udev(state, |_, data| {
        data.asleep.get(&node).map(|asleep| {
            look_on_change(
                sysfs_screens(Path::new(DRM_SYSFS), &asleep.card) == Sysfs::Connected,
                asleep.since.map(|since| since.elapsed()),
            )
        })
    })
    .flatten();
    match look {
        Some(true) => {
            if wake(state, node, "its connectors changed") {
                settle(state, node);
            }
        }
        Some(false) => {}
        None => {
            scan_connectors(state, node);
            settle(state, node);
        }
    }
}

/// udev says a GPU is gone: a sleeping one is forgotten, an open one removed.
pub(super) fn gpu_gone(state: &mut Dashi, node: DrmNode) {
    let was_asleep = with_udev(state, |_, data| data.asleep.remove(&node).is_some());
    if was_asleep == Some(true) {
        state.ipc.emit("gpus-changed", json!({}));
    } else {
        device_removed(state, node);
    }
}

/// Back on our VT: a screen may have been plugged into a sleeping GPU meanwhile.
pub(super) fn session_active(state: &mut Dashi) {
    let connected: Vec<DrmNode> = with_udev(state, |_, data| {
        data.asleep
            .iter()
            .filter(|(_, asleep)| {
                sysfs_screens(Path::new(DRM_SYSFS), &asleep.card) == Sysfs::Connected
            })
            .map(|(node, _)| *node)
            .collect()
    })
    .unwrap_or_default();
    for node in connected {
        if wake(state, node, "a screen was connected while away") {
            settle(state, node);
        }
    }
}

/// Open a sleeping GPU again. Not while the session is on another VT (the seat would refuse it).
fn wake(state: &mut Dashi, node: DrmNode, why: &str) -> bool {
    let asleep = with_udev(state, |_, data| {
        if data.session.is_active() {
            data.asleep.remove(&node)
        } else {
            None
        }
    })
    .flatten();
    let Some(asleep) = asleep else { return false };
    tracing::info!(card = asleep.card, why, "waking a GPU");
    match device_added(state, node, &asleep.path) {
        Ok(()) => {
            state.ipc.emit("gpus-changed", json!({}));
            true
        }
        Err(error) => {
            tracing::warn!(card = asleep.card, %error, "a GPU did not wake");
            with_udev(state, |_, data| data.asleep.insert(node, asleep));
            false
        }
    }
}

/// If nothing but client buffers (or nothing at all) holds `node`, put it to
/// sleep after the grace. A GPU that draws is always open.
pub(super) fn settle(state: &mut Dashi, node: DrmNode) {
    let generation = with_udev(state, |_, data| {
        let primary = data.primary_gpu;
        let next = data.holds(node)?.next();
        let device = data.devices.get_mut(&node)?;
        if is_drawing_gpu(node, primary) || device.release_pending || next == Next::Stay {
            return None;
        }
        device.release_pending = true;
        Some(device.generation)
    })
    .flatten();
    let Some(generation) = generation else { return };
    let _ = state
        .loop_handle
        .insert_source(Timer::from_duration(GRACE), move |_, _, state| {
            let next = with_udev(state, |_, data| {
                let next = data.holds(node)?.next();
                let device = data.devices.get_mut(&node)?;
                // Opened again since this was set: that opening has its own.
                if device.generation != generation {
                    return None;
                }
                device.release_pending = next == Next::Wait;
                Some(next)
            })
            .flatten();
            match next {
                Some(Next::Wait) => TimeoutAction::ToDuration(GRACE),
                Some(Next::Sleep) => {
                    sleep(state, node);
                    TimeoutAction::Drop
                }
                Some(Next::Stay) | None => TimeoutAction::Drop,
            }
        });
}

/// Let a GPU go: its renderer and EGL display, its GBM device, its DRM fd
/// (handed back to the seat), so its driver can suspend it.
fn sleep(state: &mut Dashi, node: DrmNode) {
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
    let token = device.token;
    let fd = device.fd.clone();
    let asleep = Asleep {
        path: device.path.clone(),
        card: device.card.clone(),
        since: Some(Instant::now()),
    };
    state.loop_handle.remove(token);
    drop(device);
    tracing::info!(
        card = asleep.card,
        "a GPU nothing needs: let go, so it can sleep"
    );
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
        data.asleep.insert(node, asleep);
    });
    state.ipc.emit("gpus-changed", json!({}));
}

/// Import a client's buffer. One the open GPUs cannot read wakes the
/// sleeping ones (a game on the graphics card handing over a buffer only it
/// reads), which then stay open while such buffers live.
pub(crate) fn import_dmabuf(state: &mut Dashi, dmabuf: &Dmabuf) -> bool {
    match with_udev(state, |_, data| data.import_dmabuf(dmabuf)) {
        Some(true) => return true,
        Some(false) => {}
        None => return false,
    }
    let sleeping: Vec<DrmNode> = with_udev(state, |_, data| {
        let since_failed = data.buffer_wake_failed.map(|at| at.elapsed());
        if may_wake_for_buffer(since_failed) {
            data.asleep.keys().copied().collect()
        } else {
            Vec::new()
        }
    })
    .unwrap_or_default();
    if sleeping.is_empty() {
        return false;
    }
    let woken: Vec<DrmNode> = sleeping
        .into_iter()
        .filter(|node| wake(state, *node, "a client's buffer only it may read"))
        .collect();
    if woken.is_empty() {
        with_udev(state, |_, data| {
            data.buffer_wake_failed = Some(Instant::now())
        });
        return false;
    }
    let imported = with_udev(state, |_, data| {
        let imported = data.import_dmabuf(dmabuf);
        data.buffer_wake_failed = (!imported).then(Instant::now);
        imported
    })
    .unwrap_or(false);
    for node in woken {
        settle(state, node);
    }
    imported
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
    state.ipc.emit("gpus-changed", json!({}));
    Ok(())
}
