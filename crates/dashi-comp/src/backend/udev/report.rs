//! Saying what screens' frames cost (D510): a line in the log per screen
//! every 10 s while a GPU that does not draw shows a screen (its frames cross
//! from one GPU to the other), or always with `DASHI_FRAME_STATS=1`; and
//! `frame-stats` for anyone who asks. While reporting, each frame's fence is
//! watched to time the GPUs (queue.rs); otherwise nothing is.

use std::sync::OnceLock;

use super::copy_path::CopyPath;
use super::frame::{frame_time, monotonic_now};
use super::stats::{Closed, Spread};
use super::*;
use crate::ipc::protocol::{FrameSpread, FrameStats, ScreenFrames};

/// `DASHI_FRAME_STATS=1`: report on one GPU too (the VM).
fn asked() -> bool {
    static ASKED: OnceLock<bool> = OnceLock::new();
    *ASKED.get_or_init(|| std::env::var("DASHI_FRAME_STATS").is_ok_and(|value| value == "1"))
}

/// Whether frames are reported (and the GPUs timed) now.
pub(super) fn reporting(data: &UdevData) -> bool {
    asked() || crosses_gpus(data)
}

/// A GPU that does not draw shows a screen.
fn crosses_gpus(data: &UdevData) -> bool {
    data.devices.iter().any(|(node, device)| {
        !is_drawing_gpu(*node, data.primary_gpu) && !device.screens.is_empty()
    })
}

/// The card that draws (`card1`).
pub(super) fn drawing_card(data: &UdevData) -> String {
    data.devices
        .iter()
        .find(|(node, device)| {
            device.render_node == Some(data.primary_gpu) || is_drawing_gpu(**node, data.primary_gpu)
        })
        .map_or_else(
            || data.primary_gpu.to_string(),
            |(_, device)| device.card.clone(),
        )
}

/// How a new screen on `node` is drawn: by the GPU it is on, or across (said on its first frame).
pub(super) fn first_path(
    node: DrmNode,
    render_node: Option<DrmNode>,
    primary: DrmNode,
) -> CopyPath {
    if is_drawing_gpu(node, primary) || render_node.is_none_or(|render| render == primary) {
        CopyPath::OneGpu
    } else {
        CopyPath::Unknown
    }
}

/// The summary line for a window that ended.
pub(super) fn log(screen: &Screen, closed: &Closed, drawn_by: &str, shown_by: &str) {
    let counts = &closed.counts;
    if counts.frames == 0 {
        return;
    }
    let frame = frame_time(&screen.output);
    tracing::info!(
        output = screen.output.name(),
        drawn_by,
        shown_by,
        path = screen.stats.path.name(),
        hz = format!("{:.2}", 1.0 / frame.as_secs_f64()),
        seconds = format!("{:.1}", closed.seconds),
        frames = counts.frames,
        late = counts.late,
        missed_vblanks = counts.missed,
        idle = counts.idle,
        failed = counts.failed,
        waited = counts.waited,
        compose_ms = ms(&counts.compose),
        commit_ms = ms(&counts.commit),
        gpu_ms = ms(&counts.gpu),
        flip_ms = ms(&counts.flip),
        start_ms = format!(
            "{:.1}",
            screen.stats.pacing.start(frame).as_secs_f64() * 1000.0
        ),
        "frames"
    );
}

/// "mean/max" in milliseconds, or "-" when nothing was timed.
fn ms(spread: &Spread) -> String {
    match spread.count {
        0 => "-".to_owned(),
        _ => format!("{:.2}/{:.2}", spread.mean_ms(), spread.max_ms()),
    }
}

/// `frame-stats`: every screen; none outside a seat of our own.
pub(crate) fn frame_stats(state: &mut Dashi) -> FrameStats {
    let screens = with_udev(state, |_, data| {
        let drawn_by = drawing_card(data);
        let now = monotonic_now();
        let mut screens: Vec<ScreenFrames> = data
            .devices
            .values()
            .flat_map(|device| {
                let drawn_by = drawn_by.clone();
                device
                    .screens
                    .values()
                    .map(move |screen| describe(screen, &drawn_by, &device.card, now))
            })
            .collect();
        screens.sort_by(|a, b| a.output.cmp(&b.output));
        screens
    });
    FrameStats {
        screens: screens.unwrap_or_default(),
    }
}

fn describe(screen: &Screen, drawn_by: &str, shown_by: &str, now: Duration) -> ScreenFrames {
    let Closed { seconds, counts } = screen.stats.latest(now);
    let spread = |spread: &Spread| FrameSpread {
        mean: spread.mean_ms(),
        max: spread.max_ms(),
    };
    let frame = frame_time(&screen.output);
    ScreenFrames {
        output: screen.output.name(),
        drawn_by: drawn_by.to_owned(),
        shown_by: shown_by.to_owned(),
        path: screen.stats.path.name().to_owned(),
        refresh_mhz: screen.output.current_mode().map_or(0, |mode| mode.refresh),
        vrr: screen
            .scanout
            .with_compositor(|compositor| compositor.vrr_enabled()),
        seconds,
        frames: counts.frames,
        late: counts.late,
        missed_vblanks: counts.missed,
        idle: counts.idle,
        failed: counts.failed,
        waited: counts.waited,
        compose_ms: spread(&counts.compose),
        commit_ms: spread(&counts.commit),
        gpu_ms: (counts.gpu.count > 0).then(|| spread(&counts.gpu)),
        flip_ms: spread(&counts.flip),
        start_ms: screen.stats.pacing.start(frame).as_secs_f64() * 1000.0,
    }
}
