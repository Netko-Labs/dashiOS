//! Whether a screen with nothing new to draw may stop looking (sleep): only
//! once nothing but the screens' own frame timers has woken the event loop
//! for `GRACE`. A client's request, input, IPC, a video frame, any other
//! timer or channel wakes the loop and so the screens (backend/udev/frame.rs):
//! an idle desktop is not redrawn at the refresh rate, forever.
//!
//! The grace covers what changes with time alone once an event started it
//! (a fade, a slide, a flight: each draws something new every frame while
//! it runs, which keeps its screen awake anyway, and is started by an event).

use std::time::{Duration, Instant};

/// How long after the last other wakeup a screen keeps looking at its refresh.
pub(crate) const GRACE: Duration = Duration::from_secs(1);

pub(crate) struct Wakes {
    /// When something other than a frame timer last woke the loop.
    last: Instant,
    /// A frame timer ran in this turn of the loop.
    frame_turn: bool,
    /// Something said it changed what shows, in this turn (it may share the
    /// turn with a frame timer, which would hide it otherwise).
    poked: bool,
}

impl Wakes {
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            last: now,
            frame_turn: false,
            poked: false,
        }
    }

    /// A screen's frame timer is what runs.
    pub(crate) fn frame_turn(&mut self) {
        self.frame_turn = true;
    }

    /// Clients' requests, input, IPC: what shows may have changed.
    pub(crate) fn poke(&mut self) {
        self.poked = true;
    }

    /// The end of a turn of the loop: whether anything but frame timers woke
    /// it (the sleeping screens should look again).
    pub(crate) fn turn_ended(&mut self, now: Instant) -> bool {
        let woke = self.poked || !self.frame_turn;
        self.poked = false;
        self.frame_turn = false;
        if woke {
            self.last = now;
        }
        woke
    }

    /// Whether a screen that drew nothing new may sleep now.
    pub(crate) fn may_sleep(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.last) >= GRACE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_frame_timers_for_a_while_lets_a_screen_sleep() {
        let start = Instant::now();
        let mut wakes = Wakes::new(start);
        assert!(!wakes.may_sleep(start));
        // Frame timers alone don't keep it awake.
        for ms in [16, 500, 1100] {
            wakes.frame_turn();
            assert!(!wakes.turn_ended(start + Duration::from_millis(ms)));
        }
        assert!(wakes.may_sleep(start + GRACE));
        // Anything else does, for the grace.
        let event = start + Duration::from_secs(2);
        assert!(wakes.turn_ended(event));
        assert!(!wakes.may_sleep(event + Duration::from_millis(500)));
        assert!(wakes.may_sleep(event + GRACE));
    }

    #[test]
    fn a_poke_in_a_frame_timers_turn_is_not_lost() {
        let start = Instant::now();
        let mut wakes = Wakes::new(start);
        wakes.frame_turn();
        wakes.poke();
        let at = start + Duration::from_secs(5);
        assert!(wakes.turn_ended(at));
        assert!(!wakes.may_sleep(at));
        // And it's spent.
        wakes.frame_turn();
        assert!(!wakes.turn_ended(at));
    }
}
