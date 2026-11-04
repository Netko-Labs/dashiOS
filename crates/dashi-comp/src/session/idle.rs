//! Idle: the shell asks to hear when the person has not touched anything for
//! some seconds (`idle {timeouts}`), and when they are back (`active`). What
//! idling means (blank the screens, lock, sleep) is the shell's to decide.
//! Also `person-input`: the person used the desktop, in a window or not.
//! While an idle inhibitor's surface is on screen, the person counts as there.

use std::time::{Duration, Instant};

use serde_json::json;
use smithay::reexports::calloop::timer::{TimeoutAction, Timer};

use crate::state::Dashi;

/// `person-input` at most this often for the same window.
const PERSON_INPUT_EVERY: Duration = Duration::from_millis(500);

pub(crate) struct Idle {
    timeouts: Vec<u64>,
    last_input: Instant,
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
            last_input: Instant::now(),
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
                // A video on screen counts as the person being there.
                if state.idle_inhibited() {
                    state.idle.last_input = Instant::now();
                }
                let idle_for = state.idle.last_input.elapsed().as_secs();
                let due: Vec<u64> = state
                    .idle
                    .timeouts
                    .iter()
                    .copied()
                    .filter(|t| idle_for >= *t && !state.idle.fired.contains(t))
                    .collect();
                for seconds in due {
                    state.idle.fired.push(seconds);
                    state.ipc.emit("idle", json!({ "seconds": seconds }));
                }
                TimeoutAction::ToDuration(every)
            });
    }

    /// How long since the person last touched anything.
    pub(crate) fn idle_for(&self) -> Duration {
        self.idle.last_input.elapsed()
    }

    /// The person touched something: idle ends (`active`), and the shell may hear where.
    pub(crate) fn note_input(&mut self, deliberate: bool) {
        self.idle.last_input = Instant::now();
        if !self.idle.fired.is_empty() {
            self.idle.fired.clear();
            self.ipc.emit("active", json!({}));
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
            self.ipc.emit("person-input", json!({ "window": window }));
        }
    }
}
