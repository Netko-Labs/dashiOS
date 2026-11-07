//! The watchdog on a screen's queued frames (flip.rs): one whose vblank has
//! not come a second later is given up on, and the screen draws again.

use super::frame::{monotonic_now, render_screen};
use super::*;
use flip::{FLIP_TIMEOUT, Watch};

/// Keep an eye on a screen's queued frames.
pub(super) fn watch(handle: &LoopHandle<'static, Dashi>, node: DrmNode, crtc: crtc::Handle) {
    let timer = Timer::from_duration(FLIP_TIMEOUT);
    let inserted = handle.insert_source(timer, move |_, _, state| look(state, node, crtc));
    if let Err(error) = inserted {
        tracing::warn!(%error, "watching a screen's frames");
    }
}

fn look(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) -> TimeoutAction {
    let watch = with_udev(state, |_, data| {
        let active = data.session.is_active();
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        if !active || !screen.powered {
            // Away or dark, flips may well not come; waking or lighting draws again.
            screen.flip.unwatched();
            return Some(Watch::Idle);
        }
        let watch = screen.flip.check(monotonic_now());
        if let Watch::Overdue { first } = watch {
            let output = screen.output.name();
            if first {
                tracing::warn!(
                    output,
                    "no vblank for a second after a frame; drawing again"
                );
            } else {
                tracing::debug!(output, "no vblank for a second after a frame, again");
            }
            // Give the frame up in the scanout too, so the next one is
            // committed rather than queued behind it.
            match screen.scanout.frame_submitted() {
                Ok(Some(Some(mut feedback))) => feedback.discarded(),
                Ok(_) => {}
                Err(error) => tracing::debug!(?error, "giving up a frame"),
            }
        }
        Some(watch)
    })
    .flatten();
    match watch {
        Some(Watch::Wait(after)) => TimeoutAction::ToDuration(after),
        Some(Watch::Overdue { first }) => {
            render_screen(state, node, crtc);
            let queued = with_udev(state, |_, data| {
                let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
                let queued = screen.flip.is_queued();
                if first {
                    // Which it was: a commit taken now means the event was lost;
                    // refused (busy), the flip itself is stuck (a fence that never signals).
                    tracing::info!(
                        output = screen.output.name(),
                        queued,
                        "drawn again after a lost vblank"
                    );
                }
                if !queued {
                    screen.flip.unwatched();
                }
                Some(queued)
            })
            .flatten();
            match queued {
                Some(true) => TimeoutAction::ToDuration(FLIP_TIMEOUT),
                _ => TimeoutAction::Drop,
            }
        }
        Some(Watch::Idle) | None => TimeoutAction::Drop,
    }
}
