//! Drawing the screens: a frame when something changed, queued for the next
//! vblank; at the vblank, presentation feedback, and the next frame scheduled
//! a little before the following one. A vblank that never comes is given up
//! on after a second (flip.rs, watchdog.rs), so one lost page-flip event
//! can't stop a screen, and every client's frame callbacks with it, for
//! good; a dark screen still paces its clients (pace.rs).

use super::pace::{dark_pace, schedule, unschedule};
use super::queue::{queue, watch_fence};
use super::watchdog::watch;
use super::*;
use crate::wakes::Woke;
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
pub(super) enum Turn {
    /// A frame is queued: its vblank draws the next. `watch`: set the
    /// watchdog (flip.rs); `fence`: the frame's number and fence, to time the GPUs.
    Queued {
        watch: bool,
        fence: Option<(u64, std::os::fd::OwnedFd)>,
    },
    /// The display refused the frame: draw it again, another way (planes.rs), next frame.
    Refused,
    /// Nothing new, or it failed: look again in about a frame, or sleep
    /// (wakes.rs) until something wakes it, a second at most.
    Idle,
    /// No renderer: try again in a second.
    Later,
    /// The screen is dark: only its clients' frame callbacks are paced (pace.rs).
    Dark,
}

/// Draw a screen if anything on it changed; else look again in about a frame.
pub(super) fn render_screen(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    unschedule(state, node, crtc);
    set_asleep(state, node, crtc, false);
    let outcome = with_udev(state, |state, data| draw(state, data, node, crtc)).flatten();
    let Some((output, turn)) = outcome else {
        return;
    };
    match turn {
        Turn::Queued { watch: set, fence } => {
            if set {
                watch(&state.loop_handle, node, crtc);
            }
            if let Some((frame, fence)) = fence {
                watch_fence(state, node, crtc, frame, fence);
            }
            stir(state, node, crtc);
            state.send_frames(&output);
        }
        Turn::Idle => {
            state.send_frames(&output);
            if quiet_turn(state, node, crtc) {
                set_asleep(state, node, crtc, true);
                schedule(state, node, crtc, ASLEEP_LOOK);
            } else {
                schedule(state, node, crtc, frame_time(&output));
            }
        }
        Turn::Refused => {
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

/// One turn of a screen's loop: draw it if anything changed, and queue the frame.
fn draw(
    state: &mut Dashi,
    data: &mut UdevData,
    node: DrmNode,
    crtc: crtc::Handle,
) -> Option<(Output, Turn)> {
    let primary_gpu = data.primary_gpu;
    let measure = report::reporting(data);
    let device = data.devices.get_mut(&node)?;
    let render_node = device.render_node.unwrap_or(primary_gpu);
    let screen = device.screens.get_mut(&crtc)?;
    if screen.flip.is_queued() {
        return None;
    }
    let output = screen.output.clone();
    if !screen.powered {
        return Some((output, Turn::Dark));
    }
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
    let now = monotonic_now();
    screen.stats.drawing(now, frame_time(&output));
    let flags = screen.planes.flags(now, || planes::scene(&elements));
    let rendered = screen
        .scanout
        .render_frame(&mut renderer, &elements, BACKGROUND, flags);
    let took = monotonic_now().saturating_sub(now);
    screen.stats.drawn(took, copy_path::take_seen());
    let turn = match rendered {
        Ok(result) if !result.is_empty => queue(state, screen, &output, &elements, result, measure),
        Ok(_) => {
            screen.stats.idle();
            Turn::Idle
        }
        Err(error) => {
            screen.stats.failed();
            tracing::warn!(?error, "drawing a frame");
            Turn::Idle
        }
    };
    Some((output, turn))
}

/// A vblank: the queued frame is on screen; its clients hear when. Draw the
/// next a little before the following one.
pub(super) fn frame_finished(
    state: &mut Dashi,
    node: DrmNode,
    crtc: crtc::Handle,
    metadata: Option<DrmEventMetadata>,
) {
    state.wakes.frame_turn();
    let start = with_udev(state, |_, data| {
        let reporting = report::reporting(data);
        let drawn_by = report::drawing_card(data);
        let device = data.devices.get_mut(&node)?;
        let shown_by = device.card.clone();
        let screen = device.screens.get_mut(&crtc)?;
        let (time, seq) = vblank_time(metadata);
        if screen.flip.vblank(time) == Vblank::Stale {
            tracing::debug!(output = screen.output.name(), "a given-up frame's vblank");
            return None;
        }
        let frame = frame_time(&screen.output);
        match screen.scanout.frame_submitted() {
            Ok(Some(Some(mut feedback))) => {
                let refresh = Refresh::fixed(frame);
                let flags = wp_presentation_feedback::Kind::Vsync
                    | wp_presentation_feedback::Kind::HwClock
                    | wp_presentation_feedback::Kind::HwCompletion;
                feedback.presented::<_, Monotonic>(time, refresh, seq, flags);
            }
            Ok(_) => {}
            Err(error) => tracing::debug!(?error, "frame submitted"),
        }
        let vrr = screen
            .scanout
            .with_compositor(|compositor| compositor.vrr_enabled());
        screen.stats.shown(time, frame, vrr);
        if let Some(closed) = screen.stats.roll(monotonic_now())
            && reporting
        {
            report::log(screen, &closed, &drawn_by, &shown_by);
        }
        // Leave the clients most of the frame to draw, then compose (pacing.rs).
        Some(screen.stats.pacing.start(frame))
    })
    .flatten();
    let Some(start) = start else { return };
    schedule(state, node, crtc, start);
}

/// How often a sleeping screen still looks (and paces its clients' frame callbacks).
const ASLEEP_LOOK: Duration = Duration::from_secs(1);

fn with_screen<T>(
    state: &mut Dashi,
    node: DrmNode,
    crtc: crtc::Handle,
    f: impl FnOnce(&mut Screen) -> T,
) -> Option<T> {
    with_udev(state, |_, data| {
        data.devices
            .get_mut(&node)
            .and_then(|d| d.screens.get_mut(&crtc))
            .map(f)
    })
    .flatten()
}

fn set_asleep(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle, asleep: bool) {
    with_screen(state, node, crtc, |screen| screen.asleep = asleep);
}

fn stir(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) {
    with_screen(state, node, crtc, |screen| screen.quiet.stir());
}

/// A turn with nothing new: whether the screen may sleep (wakes.rs).
fn quiet_turn(state: &mut Dashi, node: DrmNode, crtc: crtc::Handle) -> bool {
    with_screen(state, node, crtc, |screen| screen.quiet.idle_turn()).unwrap_or(false)
}

/// Something but a frame woke the event loop (wakes.rs): sleeping screens
/// look at once; a poke also keeps every screen looking for a while.
pub(crate) fn wake_screens(state: &mut Dashi, woke: Woke) {
    let asleep = with_udev(state, |_, data| {
        let mut asleep = Vec::new();
        for (node, device) in &mut data.devices {
            for (crtc, screen) in &mut device.screens {
                if woke == Woke::Poked {
                    screen.quiet.stir();
                }
                if screen.asleep {
                    asleep.push((*node, *crtc));
                }
            }
        }
        asleep
    })
    .unwrap_or_default();
    for (node, crtc) in asleep {
        set_asleep(state, node, crtc, false);
        schedule(state, node, crtc, Duration::ZERO);
    }
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

pub(super) fn frame_time(output: &Output) -> Duration {
    let refresh = output
        .current_mode()
        .map(|mode| mode.refresh)
        .filter(|r| *r > 0)
        .unwrap_or(60_000);
    Duration::from_secs_f64(1_000.0 / f64::from(refresh))
}
