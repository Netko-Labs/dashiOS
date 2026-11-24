//! What a screen's frames cost (D510): how many it drew, how many were shown
//! a vblank or more late, how long composing, committing and the GPUs took,
//! and how its picture reaches the GPU that shows it (copy_path.rs). Counted
//! in windows of 10 s, rolled as frames come (no timer of its own): the last
//! whole window goes to the log (report.rs) and to `frame-stats`.

use std::time::Duration;

use super::copy_path::CopyPath;
use super::pacing::{Pacing, missed};

/// How long a window of counts lasts.
pub(super) const WINDOW: Duration = Duration::from_secs(10);

/// Durations' count, sum and longest.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub(crate) struct Spread {
    pub count: u32,
    pub total: Duration,
    pub max: Duration,
}

impl Spread {
    pub(super) fn add(&mut self, took: Duration) {
        self.count += 1;
        self.total += took;
        self.max = self.max.max(took);
    }

    pub(crate) fn mean_ms(&self) -> f64 {
        match self.count {
            0 => 0.0,
            count => self.total.as_secs_f64() * 1000.0 / f64::from(count),
        }
    }

    pub(crate) fn max_ms(&self) -> f64 {
        self.max.as_secs_f64() * 1000.0
    }
}

/// One window's counts.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub(crate) struct Counts {
    /// Frames queued for a vblank.
    pub frames: u32,
    /// Of those, shown a vblank or more after the one they were aimed at.
    pub late: u32,
    /// The vblanks those missed, summed.
    pub missed: u32,
    /// Turns with nothing new to draw.
    pub idle: u32,
    /// Frames that failed to draw or that the display refused.
    pub failed: u32,
    /// Frames whose commit could not carry the GPU's fence: waited for on the loop.
    pub waited: u32,
    /// Drawing a frame on the event loop (smithay's `render_frame`, a copy to another GPU included).
    pub compose: Spread,
    /// Committing it (`queue_frame`).
    pub commit: Spread,
    /// From starting to draw to the GPUs' fence signalling (measured while reporting).
    pub gpu: Spread,
    /// From queueing to the vblank that showed it.
    pub flip: Spread,
}

/// A window that ended.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Closed {
    pub seconds: f64,
    pub counts: Counts,
}

/// A screen's frames, counted.
#[derive(Debug, Default)]
pub(crate) struct FrameStats {
    pub(super) path: CopyPath,
    pub(super) pacing: Pacing,
    counts: Counts,
    began: Option<Duration>,
    last: Option<Closed>,
    /// The frame being drawn or waiting for its vblank: its number, when it
    /// started, whether on schedule, and when it was queued.
    frame: u64,
    started: Duration,
    /// When the frame waiting for its fence started (an idle turn may start drawing meanwhile).
    fenced_from: Duration,
    on_schedule: bool,
    queued: Option<Duration>,
    last_vblank: Option<Duration>,
}

impl FrameStats {
    pub(super) fn new(path: CopyPath) -> Self {
        Self {
            path,
            ..Self::default()
        }
    }

    /// A frame starts drawing at `now`; the screen's frame lasts `frame`.
    pub(super) fn drawing(&mut self, now: Duration, frame: Duration) {
        self.began.get_or_insert(now);
        self.started = now;
        self.on_schedule = self
            .last_vblank
            .and_then(|vblank| now.checked_sub(vblank))
            .is_some_and(|since| self.pacing.on_schedule(frame, since));
    }

    /// It drew in `took` on the loop; `path` when it set up the way to another GPU.
    pub(super) fn drawn(&mut self, took: Duration, path: Option<CopyPath>) {
        self.counts.compose.add(took);
        if let Some(path) = path {
            self.path = path;
        }
    }

    pub(super) fn idle(&mut self) {
        self.counts.idle += 1;
    }

    pub(super) fn failed(&mut self) {
        self.counts.failed += 1;
    }

    pub(super) fn waited(&mut self) {
        self.counts.waited += 1;
    }

    /// It was queued at `at`, the commit taking `took`. Its number, to match its fence.
    pub(super) fn queued(&mut self, at: Duration, took: Duration) -> u64 {
        self.counts.frames += 1;
        self.counts.commit.add(took);
        self.queued = Some(at);
        self.fenced_from = self.started;
        self.frame += 1;
        self.frame
    }

    /// Frame `frame`'s fence signalled at `now`.
    pub(super) fn gpu_done(&mut self, frame: u64, now: Duration) {
        if frame == self.frame {
            self.counts.gpu.add(now.saturating_sub(self.fenced_from));
        }
    }

    /// The queued frame was shown at the vblank stamped `at`. `vrr`: the
    /// screen's refresh follows its frames, so none is late.
    pub(super) fn shown(&mut self, at: Duration, frame: Duration, vrr: bool) {
        let previous = self.last_vblank.replace(at);
        let Some(queued) = self.queued.take() else {
            return;
        };
        self.counts.flip.add(at.saturating_sub(queued));
        let missed = if vrr {
            Some(0)
        } else {
            missed(previous, frame, queued, at)
        };
        let Some(missed) = missed else { return };
        if missed > 0 {
            self.counts.late += 1;
            self.counts.missed += missed;
        }
        if self.on_schedule {
            self.pacing.shown(missed);
        }
    }

    /// At `now`: the window that just ended, when one did.
    pub(super) fn roll(&mut self, now: Duration) -> Option<Closed> {
        let began = *self.began.get_or_insert(now);
        let length = now.saturating_sub(began);
        if length < WINDOW {
            return None;
        }
        let closed = Closed {
            seconds: length.as_secs_f64(),
            counts: std::mem::take(&mut self.counts),
        };
        self.began = Some(now);
        self.last = Some(closed);
        Some(closed)
    }

    /// The last whole window, else the one under way.
    pub(crate) fn latest(&self, now: Duration) -> Closed {
        self.last.unwrap_or_else(|| Closed {
            seconds: self
                .began
                .map_or(0.0, |began| now.saturating_sub(began).as_secs_f64()),
            counts: self.counts,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn ms(ms: u64) -> Duration {
        Duration::from_millis(ms)
    }

    const FRAME: Duration = Duration::from_micros(16_667);

    /// Draw a frame starting `start` after the vblank at `vblank`, shown `vblanks` later.
    fn frame(stats: &mut FrameStats, vblank: Duration, start: Duration, vblanks: u32) -> Duration {
        stats.drawing(vblank + start, FRAME);
        stats.drawn(ms(2), None);
        stats.queued(vblank + start + ms(3), Duration::from_micros(200));
        let shown = vblank + FRAME * vblanks;
        stats.shown(shown, FRAME, false);
        shown
    }

    #[test]
    fn frames_on_time_and_late_are_counted_and_late_ones_start_earlier() {
        let mut stats = FrameStats::default();
        stats.shown(ms(1000), FRAME, false); // a first vblank, nothing queued
        let start = stats.pacing.start(FRAME);
        let vblank = frame(&mut stats, ms(1000), start, 1);
        let vblank = frame(&mut stats, vblank, start, 2);
        let counts = stats.latest(vblank).counts;
        assert_eq!((counts.frames, counts.late, counts.missed), (2, 1, 1));
        assert_eq!(counts.compose.count, 2);
        assert!(
            stats.pacing.start(FRAME) < start,
            "the late frame moved the start earlier"
        );
    }

    #[test]
    fn a_frame_started_off_schedule_does_not_move_the_start() {
        let mut stats = FrameStats::default();
        stats.shown(ms(1000), FRAME, false);
        // Started 13 ms after the vblank (an idle turn's look), shown a vblank late.
        frame(&mut stats, ms(1000), ms(13), 2);
        assert_eq!(stats.latest(ms(1100)).counts.late, 1);
        assert_eq!(stats.pacing, Pacing::default());
    }

    #[test]
    fn a_screen_with_vrr_has_no_late_frames() {
        let mut stats = FrameStats::default();
        stats.shown(ms(1000), FRAME, false);
        stats.drawing(ms(1010), FRAME);
        stats.queued(ms(1012), ms(0));
        stats.shown(ms(1060), FRAME, true);
        assert_eq!(stats.latest(ms(1060)).counts.late, 0);
    }

    #[test]
    fn the_gpus_time_counts_for_the_frame_it_belongs_to() {
        let mut stats = FrameStats::default();
        stats.drawing(ms(100), FRAME);
        let first = stats.queued(ms(102), ms(0));
        stats.gpu_done(first, ms(105));
        stats.drawing(ms(120), FRAME);
        stats.queued(ms(121), ms(0));
        stats.gpu_done(first, ms(125));
        // An idle turn started drawing before the second frame's fence came.
        stats.drawing(ms(130), FRAME);
        stats.gpu_done(first + 1, ms(131));
        let gpu = stats.latest(ms(140)).counts.gpu;
        assert_eq!((gpu.count, gpu.max, gpu.total), (2, ms(11), ms(16)));
    }

    #[test]
    fn a_window_closes_after_ten_seconds_and_stays_readable() {
        let mut stats = FrameStats::default();
        assert_eq!(stats.roll(ms(1000)), None);
        stats.idle();
        assert_eq!(stats.latest(ms(5000)).counts.idle, 1);
        assert_eq!(stats.roll(ms(10_999)), None);
        let closed = stats.roll(ms(11_000)).expect("a window ended");
        assert_eq!((closed.seconds, closed.counts.idle), (10.0, 1));
        stats.idle();
        assert_eq!(stats.latest(ms(12_000)), closed, "the last whole window");
    }

    #[test]
    fn spreads_say_their_mean_and_longest_in_milliseconds() {
        let mut spread = Spread::default();
        assert_eq!(spread.mean_ms(), 0.0);
        spread.add(ms(2));
        spread.add(ms(4));
        assert_eq!((spread.mean_ms(), spread.max_ms()), (3.0, 4.0));
    }
}
