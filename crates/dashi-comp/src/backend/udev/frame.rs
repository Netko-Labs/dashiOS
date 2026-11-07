//! Drawing the screens: a frame when something changed, queued for the next
//! vblank; at the vblank, presentation feedback, and the next frame scheduled
//! a little before the following one. A vblank that never comes is given up
//! on after a second (flip.rs, watchdog.rs), so one lost page-flip event
//! can't stop a screen, and every client's frame callbacks with it, for
//! good; a dark screen still paces its clients (pace.rs).

use super::pace::{dark_pace, schedule, unschedule};
use super::watchdog::watch;
use super::*;
use flip::Vblank;

pub(super) fn render_device(state: &mut Dashi, node: DrmNode) {
    let crtcs = with_udev(state, |_, data| {
        data.devices
            .get(&node)
            .map(|d| d.screens.keys().copied().collect::<Vec<_>>())
    })
    .flatten()
    .unwrap_or_default();
    for crtc in crtcs {
        render_screen(state, node, crtc);
    }
}

/// What a turn of a screen's loop did.
enum Turn {
    /// A frame is queued: its vblank draws the next.
    Queued,
    /// Nothing new, or it failed: look again in about a frame.
    Idle,
    /// No renderer: try again in a second.
    Later,
    /// The screen is dark: only its clients' frame callbacks are paced (pace.rs).
    Dark,
}

/// Draw a screen if anything on it changed; else look again in about a frame.
pub(super) fn render_screen(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    unschedule(state, node, crtc);
    let outcome = with_udev(state, |state, data| -> Option<(Output, Turn)> {
        let primary_gpu = data.primary_gpu;
        let device = data.devices.get_mut(&node)?;
        let render_node = device.render_node.unwrap_or(primary_gpu);
        let screen = device.screens.get_mut(&crtc)?;
        if screen.flip.is_queued() {
            return None;
        }
        if !screen.powered {
            return Some((screen.output.clone(), Turn::Dark));
        }
        let output = screen.output.clone();
        let fullscreen = state.fullscreen_on(&output).is_some();
        vrr::follow(screen, state.vrr_mode(&output), fullscreen);
        let renderer = if render_node == primary_gpu {
            data.gpus.single_renderer(&render_node)
        } else {
            data.gpus
                .renderer(&primary_gpu, &render_node, screen.scanout.format())
        };
        let mut renderer = match renderer {
            Ok(renderer) => renderer,
            Err(error) => {
                // Not a reason for the screen to stop for good: it tries again in a second.
                tracing::warn!(?error, "no renderer for a screen");
                return Some((output, Turn::Later));
            }
        };
        let elements = render::output_elements(state, &mut renderer, &output, true);
        let turn = match screen.scanout.render_frame(
            &mut renderer,
            &elements,
            BACKGROUND,
            FrameFlags::DEFAULT,
        ) {
            Ok(result) if !result.is_empty => {
                match screen.scanout.queue_frame(Some(state.after_render(
                    &output,
                    &result.states,
                    screen.feedback.as_ref().map(|f| (&f.render, &f.scanout)),
                ))) {
                    Ok(()) => {
                        if screen.flip.queue(monotonic_now()) {
                            watch(&state.loop_handle, node, crtc);
                        }
                        Turn::Queued
                    }
                    // Waiting out a stalled flip, the commits fail (busy) each frame: once is enough.
                    Err(error) if screen.flip.is_stalled() => {
                        tracing::debug!(?error, "queueing a frame");
                        Turn::Idle
                    }
                    Err(error) => {
                        tracing::warn!(?error, "queueing a frame");
                        Turn::Idle
                    }
                }
            }
            Ok(_) => Turn::Idle,
            Err(error) => {
                tracing::warn!(?error, "drawing a frame");
                Turn::Idle
            }
        };
        Some((output, turn))
    })
    .flatten();
    let Some((output, turn)) = outcome else {
        return;
    };
    match turn {
        Turn::Queued => state.send_frames(&output),
        Turn::Idle => {
            state.send_frames(&output);
            schedule(state, node, crtc, frame_time(&output));
        }
        Turn::Later => {
            state.send_frames(&output);
            schedule(state, node, crtc, Duration::from_secs(1));
        }
        Turn::Dark => {
            state.send_frames_dark(&output);
            let acted = state.agent.acted_at.map(|at| at.elapsed());
            schedule(state, node, crtc, dark_pace(frame_time(&output), acted));
        }
    }
}

/// A vblank: the queued frame is on screen; its clients hear when. Draw the
/// next a little before the following one.
pub(super) fn frame_finished(
    state: &mut Dashi,
    node: DrmNode,
    crtc: crtc::Handle,
    metadata: Option<DrmEventMetadata>,
) {
    let output = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        let (time, seq) = vblank_time(metadata);
        if screen.flip.vblank(time) == Vblank::Stale {
            tracing::debug!(output = screen.output.name(), "a given-up frame's vblank");
            return None;
        }
        match screen.scanout.frame_submitted() {
            Ok(Some(Some(mut feedback))) => {
                let refresh = Refresh::fixed(frame_time(&screen.output));
                let flags = wp_presentation_feedback::Kind::Vsync
                    | wp_presentation_feedback::Kind::HwClock
                    | wp_presentation_feedback::Kind::HwCompletion;
                feedback.presented::<_, Monotonic>(time, refresh, seq, flags);
            }
            Ok(_) => {}
            Err(error) => tracing::debug!(?error, "frame submitted"),
        }
        Some(screen.output.clone())
    })
    .flatten();
    let Some(output) = output else { return };
    // Leave the clients most of the frame to draw, then compose.
    schedule(state, node, crtc, frame_time(&output).mul_f64(0.6));
}

pub(super) fn monotonic_now() -> Duration {
    Duration::from(Clock::<Monotonic>::new().now())
}

/// When the vblank was (monotonic) and its sequence; now, if DRM did not say.
fn vblank_time(metadata: Option<DrmEventMetadata>) -> (Duration, u64) {
    let now = monotonic_now;
    match metadata {
        Some(DrmEventMetadata {
            time: DrmEventTime::Monotonic(time),
            sequence,
        }) => (time, u64::from(sequence)),
        Some(DrmEventMetadata { sequence, .. }) => (now(), u64::from(sequence)),
        None => (now(), 0),
    }
}

fn frame_time(output: &Output) -> Duration {
    let refresh = output
        .current_mode()
        .map(|mode| mode.refresh)
        .filter(|r| *r > 0)
        .unwrap_or(60_000);
    Duration::from_secs_f64(1_000.0 / f64::from(refresh))
}
