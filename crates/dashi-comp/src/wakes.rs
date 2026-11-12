//! When a screen with nothing new to draw stops looking (sleeps), and what
//! wakes it. An idle desktop is not redrawn at the refresh rate, forever.
//!
//! A screen keeps looking at its refresh while it draws, and for
//! `QUIET_TURNS` turns after its last frame or after the last poke (a
//! client's request, input, IPC: what starts a fade, which may draw nothing
//! new on its first frame). Then it sleeps, looking only once a second
//! (backend/udev/frame.rs). Anything else that wakes the event loop (a timer,
//! a channel: a slide's or the overview's frame timer, a video frame, the idle
//! watch's tick) makes a sleeping screen look once: it draws if anything
//! changed, and sleeps again at once if not.

/// Turns with nothing new (frames at the refresh) before a screen sleeps.
pub(crate) const QUIET_TURNS: u32 = 30;

/// What woke the event loop in one turn of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Woke {
    /// Only screens' frame timers and vblanks.
    Frames,
    /// Something else (a timer, a channel): sleeping screens look once.
    Other,
    /// A client's request, input, or IPC: screens look again for a while.
    Poked,
}

#[derive(Default)]
pub(crate) struct Wakes {
    /// A frame timer or vblank ran in this turn of the loop.
    frame_turn: bool,
    /// Something said it may have changed what shows, in this turn (it may
    /// share the turn with a frame timer, which would hide it otherwise).
    poked: bool,
}

impl Wakes {
    /// A screen's frame timer or vblank is what runs.
    pub(crate) fn frame_turn(&mut self) {
        self.frame_turn = true;
    }

    /// Clients' requests, input, IPC: what shows may have changed.
    pub(crate) fn poke(&mut self) {
        self.poked = true;
    }

    /// The end of a turn of the loop: what woke it.
    pub(crate) fn turn_ended(&mut self) -> Woke {
        let woke = if self.poked {
            Woke::Poked
        } else if self.frame_turn {
            Woke::Frames
        } else {
            Woke::Other
        };
        self.poked = false;
        self.frame_turn = false;
        woke
    }
}

/// One screen's count of turns with nothing new.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Quiet {
    turns: u32,
}

impl Quiet {
    /// It drew a frame, or was poked: look again for a while.
    pub(crate) fn stir(&mut self) {
        self.turns = 0;
    }

    /// A turn with nothing new: whether it may sleep now.
    pub(crate) fn idle_turn(&mut self) -> bool {
        self.turns = self.turns.saturating_add(1);
        self.turns >= QUIET_TURNS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_says_what_woke_it() {
        let mut wakes = Wakes::default();
        wakes.frame_turn();
        assert_eq!(wakes.turn_ended(), Woke::Frames);
        assert_eq!(wakes.turn_ended(), Woke::Other);
        // A poke in a frame timer's turn is not lost, and is spent.
        wakes.frame_turn();
        wakes.poke();
        assert_eq!(wakes.turn_ended(), Woke::Poked);
        wakes.frame_turn();
        assert_eq!(wakes.turn_ended(), Woke::Frames);
    }

    #[test]
    fn a_screen_sleeps_after_quiet_turns_and_a_stir_keeps_it_looking() {
        let mut quiet = Quiet::default();
        for _ in 1..QUIET_TURNS {
            assert!(!quiet.idle_turn());
        }
        assert!(quiet.idle_turn());
        // Woken by a timer and still nothing new: asleep again at once.
        assert!(quiet.idle_turn());
        // A frame drawn (or a poke): it looks again for a while.
        quiet.stir();
        assert!(!quiet.idle_turn());
    }
}
