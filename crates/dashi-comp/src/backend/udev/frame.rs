//! Drawing the screens: a frame when something changed, queued for the next
//! vblank; at the vblank, presentation feedback, and the next frame scheduled
//! a little before the following one. A vblank that never comes is given up
//! on after a second (flip.rs), so one lost page-flip event can't stop a
//! screen, and every client's frame callbacks with it, for good.

use super::*;
use flip::{FLIP_TIMEOUT, Vblank, Watch};

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

/// Draw a screen if anything on it changed; else look again in about a frame.
pub(super) fn render_screen(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    let outcome = with_udev(state, |state, data| -> Option<(Output, bool)> {
        let primary_gpu = data.primary_gpu;
        let device = data.devices.get_mut(&node)?;
        let render_node = device.render_node.unwrap_or(primary_gpu);
        let screen = device.screens.get_mut(&crtc)?;
        screen.scheduled = false;
        if screen.flip.is_queued() || !screen.powered {
            return None;
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
        let mut renderer = renderer
            .inspect_err(|error| tracing::warn!(?error, "no renderer for a screen"))
            .ok()?;
        let elements = render::output_elements(state, &mut renderer, &output, true);
        let drawn = match screen.scanout.render_frame(
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
                        true
                    }
                    // Waiting out a stalled flip, the commits fail (busy) each frame: once is enough.
                    Err(error) if screen.flip.is_stalled() => {
                        tracing::debug!(?error, "queueing a frame");
                        false
                    }
                    Err(error) => {
                        tracing::warn!(?error, "queueing a frame");
                        false
                    }
                }
            }
            Ok(_) => false,
            Err(error) => {
                tracing::warn!(?error, "drawing a frame");
                false
            }
        };
        Some((output, drawn))
    })
    .flatten();
    let Some((output, drawn)) = outcome else {
        return;
    };
    state.send_frames(&output);
    if !drawn {
        schedule(state, node, crtc, frame_time(&output));
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

/// Keep an eye on a screen's queued frames: one whose vblank has not come a
/// second later is given up on, and the screen draws again.
fn watch(handle: &LoopHandle<'static, Dashi>, node: DrmNode, crtc: crtc::Handle) {
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

fn schedule(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle, after: Duration) {
    let already = with_udev(state, |_, data| {
        let screen = data.devices.get_mut(&node)?.screens.get_mut(&crtc)?;
        Some(std::mem::replace(&mut screen.scheduled, true))
    })
    .flatten();
    if already != Some(false) {
        return;
    }
    let _ = state
        .loop_handle
        .insert_source(Timer::from_duration(after), move |_, _, state| {
            render_screen(state, node, crtc);
            TimeoutAction::Drop
        });
}

fn monotonic_now() -> Duration {
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
