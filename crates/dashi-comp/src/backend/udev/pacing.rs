//! When a screen starts composing after a vblank, and whether a frame made
//! the vblank it was aimed at (D511).
//!
//! A screen composes 0.6 of a frame after its last vblank, leaving its
//! clients most of the frame to draw. A screen whose frames take longer than
//! the rest of the frame (one another GPU shows: composed on the drawing GPU,
//! then copied by the other) missed its vblank and showed every other frame
//! late. So each frame shown a vblank late (or more) that started on time
//! moves the start earlier by a tenth of a frame, down to a tenth; 600 frames
//! in a row on time move it back a twentieth, up to 0.6 again. A screen that
//! makes its vblanks never moves.

use std::time::Duration;

/// The latest a screen starts composing, as a share of its frame (the clients' time before it).
pub(super) const LATEST: f64 = 0.6;
/// The earliest.
const EARLIEST: f64 = 0.1;
/// How much earlier a late frame moves the start.
const EARLIER: f64 = 0.1;
/// How much later a run of frames on time moves it.
const LATER: f64 = 0.05;
/// Frames on time in a row before the start moves later.
const ON_TIME_RUN: u32 = 600;
/// A frame that started this long after its paced start did not start on time.
const STARTED_LATE: Duration = Duration::from_millis(2);
/// Vblanks further apart than this tell nothing of the one a frame was aimed at.
const STALE: Duration = Duration::from_secs(1);

/// One screen's start, as a share of its frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Pacing {
    share: f64,
    on_time: u32,
}

impl Default for Pacing {
    fn default() -> Self {
        Self {
            share: LATEST,
            on_time: 0,
        }
    }
}

impl Pacing {
    /// How long after a vblank to start composing.
    pub(super) fn start(&self, frame: Duration) -> Duration {
        frame.mul_f64(self.share)
    }

    /// Whether a frame starting `since` after the last vblank starts when it was paced to.
    pub(super) fn on_schedule(&self, frame: Duration, since: Duration) -> bool {
        since <= self.start(frame) + STARTED_LATE
    }

    /// A frame that started on schedule was shown, `missed` vblanks after its own.
    pub(super) fn shown(&mut self, missed: u32) {
        if missed > 0 {
            self.share = (self.share - EARLIER).max(EARLIEST);
            self.on_time = 0;
            return;
        }
        self.on_time += 1;
        if self.on_time >= ON_TIME_RUN {
            self.share = (self.share + LATER).min(LATEST);
            self.on_time = 0;
        }
    }
}

/// How many vblanks a frame queued at `queued` and shown at `shown` missed.
/// It was aimed at the first vblank after `queued`; vblanks fall every
/// `frame` from `last`, the one before. None when that says nothing: no
/// vblank before, or one too long ago to count from.
pub(super) fn missed(
    last: Option<Duration>,
    frame: Duration,
    queued: Duration,
    shown: Duration,
) -> Option<u32> {
    let last = last?;
    let since = queued.checked_sub(last)?;
    if frame.is_zero() || since > STALE {
        return None;
    }
    let after = since.as_nanos() / frame.as_nanos() + 1;
    let aimed = last + frame * u32::try_from(after).ok()?;
    let behind = shown.saturating_sub(aimed);
    if behind <= frame / 2 {
        return Some(0);
    }
    let missed = (behind.as_secs_f64() / frame.as_secs_f64()).round();
    Some(missed.max(1.0) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn ms(ms: u64) -> Duration {
        Duration::from_millis(ms)
    }

    const FRAME: Duration = Duration::from_micros(16_667);

    #[test]
    fn a_frame_shown_at_its_vblank_missed_none() {
        // Vblank at 1000 ms, composed at 1010, shown at the next vblank.
        let shown = ms(1000) + FRAME;
        assert_eq!(missed(Some(ms(1000)), FRAME, ms(1010), shown), Some(0));
    }

    #[test]
    fn a_frame_shown_a_vblank_later_missed_one() {
        let shown = ms(1000) + FRAME * 2;
        assert_eq!(missed(Some(ms(1000)), FRAME, ms(1012), shown), Some(1));
        let shown = ms(1000) + FRAME * 4;
        assert_eq!(missed(Some(ms(1000)), FRAME, ms(1012), shown), Some(3));
    }

    #[test]
    fn a_frame_queued_after_a_vblank_it_did_not_wait_for_aims_at_the_next() {
        // Queued 1.5 frames after the last vblank: aimed at the second one after it.
        let queued = ms(1000) + FRAME + FRAME / 2;
        assert_eq!(
            missed(Some(ms(1000)), FRAME, queued, ms(1000) + FRAME * 2),
            Some(0)
        );
    }

    #[test]
    fn nothing_is_known_without_a_recent_vblank() {
        assert_eq!(missed(None, FRAME, ms(10), ms(20)), None);
        assert_eq!(missed(Some(ms(0)), FRAME, ms(2000), ms(2010)), None);
        assert_eq!(missed(Some(ms(50)), FRAME, ms(10), ms(60)), None);
        assert_eq!(missed(Some(ms(0)), Duration::ZERO, ms(10), ms(20)), None);
    }

    #[test]
    fn a_screen_that_makes_its_vblanks_starts_at_six_tenths() {
        let mut pacing = Pacing::default();
        for _ in 0..2000 {
            pacing.shown(0);
        }
        assert_eq!(pacing.start(ms(10)), ms(6));
    }

    #[test]
    fn late_frames_start_earlier_down_to_a_tenth() {
        let mut pacing = Pacing::default();
        pacing.shown(1);
        assert_eq!(pacing.start(ms(100)), ms(50));
        for _ in 0..10 {
            pacing.shown(2);
        }
        assert_eq!(pacing.start(ms(100)), ms(10));
    }

    #[test]
    fn a_run_on_time_moves_the_start_back_slowly() {
        let mut pacing = Pacing::default();
        pacing.shown(1);
        pacing.shown(1);
        assert_eq!(pacing.start(ms(100)), ms(40));
        for _ in 0..ON_TIME_RUN - 1 {
            pacing.shown(0);
        }
        assert_eq!(pacing.start(ms(100)), ms(40));
        pacing.shown(0);
        assert_eq!(pacing.start(ms(100)), ms(45));
        // A late frame starts the run over.
        for _ in 0..ON_TIME_RUN - 1 {
            pacing.shown(0);
        }
        pacing.shown(1);
        assert_eq!(pacing.start(ms(100)), ms(35));
    }

    #[test]
    fn a_frame_started_well_after_its_paced_start_is_not_on_schedule() {
        let pacing = Pacing::default();
        assert!(pacing.on_schedule(ms(100), ms(60)));
        assert!(pacing.on_schedule(ms(100), ms(61)));
        assert!(!pacing.on_schedule(ms(100), ms(70)));
    }
}
