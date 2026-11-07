//! When a screen draws next: one timer per screen, and a call that wants it
//! sooner than the one set replaces it, so the screen never runs two loops.
//!
//! A dark screen (`power {on: false}`, the screens blanked after the person
//! went idle) draws nothing but still paces its clients' frame callbacks:
//! once a second, and at its refresh for a while after an agent's input.
//! Without that every client stopped painting the moment the screens went
//! dark, and an agent working on through `agent-input` (which isn't the
//! person, so it doesn't wake them) saw a desktop frozen in its last frame
//! (reviews 20 and 21: the clock and every window stopped; its screenshots
//! are drawn on demand, from the clients' last buffers).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use super::frame::render_screen;
use super::*;

/// Tells a screen's timers apart, so a spent one clears only its own mark.
static NEXT_TIMER: AtomicU64 = AtomicU64::new(0);

/// A dark screen's pace for its clients' frame callbacks.
const DARK_FRAME: Duration = Duration::from_secs(1);
/// How long after an agent's input a dark screen keeps its refresh's pace.
const AGENT_BRISK: Duration = Duration::from_secs(5);

/// How soon a dark screen paces its clients again: the refresh's frame while
/// an agent acted within `AGENT_BRISK`, else once a second.
pub(super) fn dark_pace(frame: Duration, agent_acted: Option<Duration>) -> Duration {
    match agent_acted {
        Some(ago) if ago < AGENT_BRISK => frame,
        _ => DARK_FRAME,
    }
}

/// Draw the screen in `after`, unless it is already set to draw sooner.
pub(super) fn schedule(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle, after: Duration) {
    let due = Instant::now() + after;
    let replaced = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        match screen.scheduled {
            Some((_, at, _)) if at <= due => None,
            _ => Some(screen.scheduled.take().map(|(token, _, _)| token)),
        }
    })
    .flatten();
    let Some(replaced) = replaced else { return };
    if let Some(token) = replaced {
        state.loop_handle.remove(token);
    }
    let id = NEXT_TIMER.fetch_add(1, Ordering::Relaxed);
    let timer = Timer::from_duration(after);
    let inserted = state.loop_handle.insert_source(timer, move |_, _, state| {
        // This timer is spent: render_screen must not remove it (another's stays).
        with_udev(state, |_, data| {
            if let Some(screen) = data
                .devices
                .get_mut(&node)
                .and_then(|d| d.screens.get_mut(&crtc))
                && screen.scheduled.is_some_and(|(_, _, of)| of == id)
            {
                screen.scheduled = None;
            }
        });
        render_screen(state, node, crtc);
        TimeoutAction::Drop
    });
    match inserted {
        Ok(token) => {
            with_udev(state, |_, data| {
                if let Some(screen) = data
                    .devices
                    .get_mut(&node)
                    .and_then(|d| d.screens.get_mut(&crtc))
                {
                    screen.scheduled = Some((token, due, id));
                }
            });
        }
        Err(error) => tracing::warn!(%error, "scheduling a screen's frame"),
    }
}

/// The screen draws now: the timer set for it, if any, goes.
pub(super) fn unschedule(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    let token = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        screen.scheduled.take().map(|(token, _, _)| token)
    })
    .flatten();
    if let Some(token) = token {
        state.loop_handle.remove(token);
    }
}

/// An agent acted: dark screens' clients hear of a frame now (to show what
/// the input did), and at the refresh's pace for a while after.
pub(crate) fn agent_acted(state: &mut Dashi) {
    state.agent.acted_at = Some(Instant::now());
    let dark = with_udev(state, |_, data| {
        data.devices
            .iter()
            .flat_map(|(node, device)| {
                device
                    .screens
                    .iter()
                    .filter(|(_, screen)| !screen.powered)
                    .map(|(crtc, _)| (*node, *crtc))
            })
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    for (node, crtc) in dark {
        render_screen(state, node, crtc);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dark_screen_paces_its_clients_once_a_second_and_briskly_after_an_agent() {
        let frame = Duration::from_micros(16_667);
        assert_eq!(dark_pace(frame, None), DARK_FRAME);
        assert_eq!(dark_pace(frame, Some(Duration::from_secs(1))), frame);
        assert_eq!(dark_pace(frame, Some(Duration::from_secs(6))), DARK_FRAME);
    }
}
