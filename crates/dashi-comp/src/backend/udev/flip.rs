//! A screen's frame between queueing and its vblank, and the watchdog that
//! keeps one lost page-flip event from stopping the screen for good: with no
//! vblank a second after a frame was queued, the screen draws again (frame.rs).

use std::time::Duration;

/// How long a queued frame may wait for its vblank before the screen gives up
/// on it and draws again.
pub(super) const FLIP_TIMEOUT: Duration = Duration::from_secs(1);

/// Times are monotonic (`CLOCK_MONOTONIC`, as DRM stamps its events).
#[derive(Debug, Default)]
pub(super) struct Flip {
    /// When the frame in flight was queued; None while none is.
    queued_at: Option<Duration>,
    /// A vblank was overdue and none has come since: the watchdog said so
    /// once and stays quiet until one does.
    stalled: bool,
    /// The watchdog's timer is set.
    watched: bool,
}

/// What a vblank meant.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Vblank {
    /// The queued frame is on screen.
    Shown,
    /// None was queued (the watchdog gave up on it, or the screen was reset):
    /// the scanout hears of it, which is harmless when it holds no frame.
    Late,
    /// From a frame the watchdog gave up on, stamped before the one now
    /// queued: ignored, so the queued frame still waits for its own.
    Stale,
}

/// What the watchdog should do now.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Watch {
    /// Look again after this long.
    Wait(Duration),
    /// The vblank is overdue: the frame is given up on; draw again. `first`
    /// when this starts a stall (the one time to warn).
    Overdue { first: bool },
    /// Nothing is queued: the timer can go.
    Idle,
}

impl Flip {
    pub(super) fn is_queued(&self) -> bool {
        self.queued_at.is_some()
    }

    pub(super) fn is_stalled(&self) -> bool {
        self.stalled
    }

    /// A frame was queued at `now`. True when the watchdog's timer must be set.
    pub(super) fn queue(&mut self, now: Duration) -> bool {
        self.queued_at = Some(now);
        !std::mem::replace(&mut self.watched, true)
    }

    /// The screen was reset (powered, a new mode, the session back): no frame
    /// is waiting any more.
    pub(super) fn clear(&mut self) {
        self.queued_at = None;
        self.stalled = false;
    }

    /// A vblank stamped `at` came.
    pub(super) fn vblank(&mut self, at: Duration) -> Vblank {
        match self.queued_at {
            Some(queued) if self.stalled && at < queued => Vblank::Stale,
            Some(_) => {
                self.queued_at = None;
                self.stalled = false;
                Vblank::Shown
            }
            None => {
                self.stalled = false;
                Vblank::Late
            }
        }
    }

    /// The watchdog's timer fired at `now`.
    pub(super) fn check(&mut self, now: Duration) -> Watch {
        let Some(queued) = self.queued_at else {
            self.watched = false;
            return Watch::Idle;
        };
        let waited = now.saturating_sub(queued);
        if waited < FLIP_TIMEOUT {
            return Watch::Wait(FLIP_TIMEOUT - waited);
        }
        self.queued_at = None;
        Watch::Overdue {
            first: !std::mem::replace(&mut self.stalled, true),
        }
    }

    /// The watchdog's timer went without a look (the screen dark, the session away).
    pub(super) fn unwatched(&mut self) {
        self.watched = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn ms(ms: u64) -> Duration {
        Duration::from_millis(ms)
    }

    #[test]
    fn a_vblank_shows_the_queued_frame() {
        let mut flip = Flip::default();
        assert!(flip.queue(ms(100)));
        assert!(flip.is_queued());
        assert_eq!(flip.vblank(ms(116)), Vblank::Shown);
        assert!(!flip.is_queued());
        // The timer is still set until it next looks and finds nothing queued.
        assert!(!flip.queue(ms(150)));
        assert_eq!(flip.vblank(ms(166)), Vblank::Shown);
        assert_eq!(flip.check(ms(1150)), Watch::Idle);
        assert!(flip.queue(ms(2000)));
    }

    #[test]
    fn the_watchdog_waits_out_the_rest_of_the_second() {
        let mut flip = Flip::default();
        flip.queue(ms(100));
        assert_eq!(flip.check(ms(400)), Watch::Wait(ms(700)));
        assert!(flip.is_queued());
        assert!(!flip.is_stalled());
    }

    #[test]
    fn no_vblank_for_a_second_gives_the_frame_up_and_warns_once() {
        let mut flip = Flip::default();
        flip.queue(ms(100));
        assert_eq!(flip.check(ms(1100)), Watch::Overdue { first: true });
        assert!(!flip.is_queued(), "the screen can draw again");
        assert!(flip.is_stalled());
        // Drawn again, and lost again: given up on, without a second warning.
        assert!(!flip.queue(ms(1120)));
        assert_eq!(flip.check(ms(2120)), Watch::Overdue { first: false });
        // A vblank ends the stall; the next one warns again.
        flip.queue(ms(2140));
        assert_eq!(flip.vblank(ms(2156)), Vblank::Shown);
        assert!(!flip.is_stalled());
        flip.queue(ms(3000));
        assert_eq!(flip.check(ms(4000)), Watch::Overdue { first: true });
    }

    #[test]
    fn a_vblank_after_the_timeout_is_ignored_safely() {
        let mut flip = Flip::default();
        flip.queue(ms(100));
        assert_eq!(flip.check(ms(1100)), Watch::Overdue { first: true });
        // The lost frame's vblank turns up while nothing is queued.
        assert_eq!(flip.vblank(ms(1105)), Vblank::Late);
        assert!(!flip.is_queued());
        assert!(!flip.is_stalled());
    }

    #[test]
    fn a_late_vblank_does_not_stand_for_the_frame_drawn_after_the_timeout() {
        let mut flip = Flip::default();
        flip.queue(ms(100));
        assert_eq!(flip.check(ms(1100)), Watch::Overdue { first: true });
        flip.queue(ms(1120));
        // Stamped before the new frame was queued: the old frame's.
        assert_eq!(flip.vblank(ms(1110)), Vblank::Stale);
        assert!(flip.is_queued());
        // The new frame's own.
        assert_eq!(flip.vblank(ms(1136)), Vblank::Shown);
        assert!(!flip.is_queued());
    }

    #[test]
    fn a_reset_screen_waits_for_nothing() {
        let mut flip = Flip::default();
        flip.queue(ms(100));
        flip.check(ms(1100));
        flip.clear();
        assert!(!flip.is_queued());
        assert!(!flip.is_stalled());
        assert_eq!(flip.check(ms(1200)), Watch::Idle);
    }
}
