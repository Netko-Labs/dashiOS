//! Idle: the shell asks to hear when the person has not touched anything for
//! some seconds (`idle {timeouts}`), and when they are back (`active`). What
//! idling means (blank the screens, lock, sleep) is the shell's to decide.
//! Also `person-input`: the person used the desktop, in a window or not.
//! While an idle inhibitor's surface is on screen, the screen stays awake as
//! if the person were there; but only the person's own input says they are
//! at the desktop (`Activity`), which is what an agent borrowing their seat
//! waits on (session/agent.rs).

use crate::ipc::protocol::Event;
use std::time::{Duration, Instant};

use smithay::reexports::calloop::timer::{TimeoutAction, Timer};

use crate::state::Dashi;

/// `person-input` at most this often for the same window.
const PERSON_INPUT_EVERY: Duration = Duration::from_millis(500);

/// What stirred the desktop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stir {
    /// The person's own hands: a device's event (libinput, or the VM's).
    Person,
    /// A surface asking to keep the screen on (a video, a page playing sound),
    /// on screen: the screen stays awake, but nobody touched anything.
    KeptAwake,
}

/// When the desktop last stirred, and when the person last did. An agent's
/// own input (session/agent.rs) is neither: it never makes the person look
/// busy, nor keeps the screen awake.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Activity {
    any: Instant,
    person: Instant,
}

impl Activity {
    pub(crate) fn new(now: Instant) -> Self {
        Self {
            any: now,
            person: now,
        }
    }

    pub(crate) fn stir(&mut self, what: Stir, at: Instant) {
        self.any = at;
        if what == Stir::Person {
            self.person = at;
        }
    }

    /// How long the screen has had nothing to stay awake for (the idle thresholds).
    pub(crate) fn idle_for(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.any)
    }

    /// How long since the person's own last input.
    pub(crate) fn person_away_for(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.person)
    }

    /// Whether an action may borrow the person's seat, wanting them away
    /// `quiet`: `Err` holds how much longer to wait.
    pub(crate) fn may_borrow(&self, now: Instant, quiet: Duration) -> Result<(), Duration> {
        let away = self.person_away_for(now);
        if away >= quiet {
            Ok(())
        } else {
            Err(quiet - away)
        }
    }
}

pub(crate) struct Idle {
    timeouts: Vec<u64>,
    activity: Activity,
    /// Thresholds already announced since the last input.
    fired: Vec<u64>,
    watching: bool,
    last_person: Option<(Option<u64>, Instant)>,
    /// Surfaces asking to keep the screen on (idle-inhibit, handlers/inhibit.rs).
    pub inhibitors: Vec<smithay::reexports::wayland_server::protocol::wl_surface::WlSurface>,
}

impl Default for Idle {
    fn default() -> Self {
        Self {
            timeouts: Vec::new(),
            activity: Activity::new(Instant::now()),
            fired: Vec::new(),
            watching: false,
            last_person: None,
            inhibitors: Vec::new(),
        }
    }
}

impl Dashi {
    /// `idle {timeouts}`: the thresholds, in seconds, as a set (replacing the last).
    pub(crate) fn set_idle_timeouts(&mut self, mut timeouts: Vec<u64>) {
        timeouts.retain(|t| (1..=86_400).contains(t));
        timeouts.sort_unstable();
        timeouts.dedup();
        self.idle.timeouts = timeouts;
        self.idle.fired.retain(|t| self.idle.timeouts.contains(t));
        if self.idle.watching || self.idle.timeouts.is_empty() {
            return;
        }
        self.idle.watching = true;
        let every = Duration::from_millis(500);
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(every), move |_, _, state| {
                if state.idle.timeouts.is_empty() {
                    state.idle.watching = false;
                    return TimeoutAction::Drop;
                }
                // A video on screen keeps the screen awake (but is not the person: `Activity`).
                if state.idle_inhibited() {
                    state.idle.activity.stir(Stir::KeptAwake, Instant::now());
                }
                let idle_for = state.idle.activity.idle_for(Instant::now()).as_secs();
                let due: Vec<u64> = state
                    .idle
                    .timeouts
                    .iter()
                    .copied()
                    .filter(|t| idle_for >= *t && !state.idle.fired.contains(t))
                    .collect();
                for seconds in due {
                    state.idle.fired.push(seconds);
                    state.ipc.emit(Event::Idle { seconds });
                }
                TimeoutAction::ToDuration(every)
            });
    }

    /// The person's activity (`Activity`): what an agent borrowing their seat waits on.
    pub(crate) fn activity(&self) -> &Activity {
        &self.idle.activity
    }

    /// The person touched something: idle ends (`active`), and the shell may hear where.
    pub(crate) fn note_input(&mut self, deliberate: bool) {
        self.idle.activity.stir(Stir::Person, Instant::now());
        if !self.idle.fired.is_empty() {
            self.idle.fired.clear();
            self.ipc.emit(Event::Active);
        }
        if !deliberate {
            return;
        }
        let window = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .and_then(|focus| crate::wm::window_id_for_surface(self, &focus));
        let recent = self
            .idle
            .last_person
            .is_some_and(|(last, at)| last == window && at.elapsed() < PERSON_INPUT_EVERY);
        if !recent {
            self.idle.last_person = Some((window, Instant::now()));
            self.ipc.emit(Event::PersonInput { window });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUIET: Duration = Duration::from_millis(2000);
    const fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    /// Review 49: the agent's click started a tone in Helium, Helium asked to
    /// keep the screen on, and every agent action after it was refused as "the
    /// person is using the desktop" for as long as it played, nobody there.
    #[test]
    fn a_page_keeping_the_screen_awake_is_not_the_person() {
        let start = Instant::now();
        let mut activity = Activity::new(start);
        // The idle watcher's tick, every 500 ms for a minute, while the page plays.
        for tick in 1..=120 {
            activity.stir(Stir::KeptAwake, start + ms(500 * tick));
        }
        let now = start + ms(60_000);
        // The screen stays awake…
        assert!(activity.idle_for(now) <= ms(500));
        // …but the person has been away the whole minute, and the agent may act.
        assert_eq!(activity.person_away_for(now), ms(60_000));
        assert_eq!(activity.may_borrow(now, QUIET), Ok(()));
    }

    #[test]
    fn the_person_wins_at_once_and_is_waited_out() {
        let start = Instant::now();
        let mut activity = Activity::new(start);
        assert_eq!(activity.may_borrow(start + ms(5000), QUIET), Ok(()));
        // The person presses a key: the agent's very next action is refused.
        let pressed = start + ms(5000);
        activity.stir(Stir::Person, pressed);
        assert_eq!(activity.may_borrow(pressed, QUIET), Err(QUIET));
        assert_eq!(activity.may_borrow(pressed + ms(1500), QUIET), Err(ms(500)));
        // A page keeping the screen awake meanwhile changes nothing for the agent.
        activity.stir(Stir::KeptAwake, pressed + ms(1900));
        // QUIET after their last input, the agent gets the seat back.
        assert_eq!(activity.may_borrow(pressed + QUIET, QUIET), Ok(()));
        assert_eq!(activity.idle_for(pressed + QUIET), ms(100));
    }

    #[test]
    fn the_person_still_keeps_the_screen_awake() {
        let start = Instant::now();
        let mut activity = Activity::new(start);
        activity.stir(Stir::Person, start + ms(30_000));
        assert_eq!(activity.idle_for(start + ms(31_000)), ms(1000));
        assert_eq!(activity.person_away_for(start + ms(31_000)), ms(1000));
    }
}
