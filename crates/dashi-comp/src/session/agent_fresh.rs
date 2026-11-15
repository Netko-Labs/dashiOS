//! A window's picture after the agent's own input: `capture {window}` asked
//! while the window has not drawn since the agent last acted in it waits for
//! the frame that follows (the window's next commit with a buffer), so what
//! the agent sees is what it did. Bounded: `FRESH_WAIT` after the input the
//! picture is taken whatever the window did (a press that changed nothing
//! draws nothing). A picture asked later than that never waits.
//!
//! Measured before this (dashi-0.9.0-review/08-marquee/installed): a picture
//! asked within 50 ms of typing showed the frame from before, ten of ten.

use std::time::{Duration, Instant};

use crate::{
    ipc::methods::{
        Ask,
        capture::{self, CaptureParams},
    },
    state::Dashi,
    wm::WindowId,
};

/// How long after the agent's input a picture of that window waits, at most, for its next frame.
pub(crate) const FRESH_WAIT: Duration = Duration::from_millis(250);

/// A `capture` that waits for its window's next frame.
pub(crate) struct Waiting {
    window: WindowId,
    until: Instant,
    ask: Ask,
    params: CaptureParams,
}

#[derive(Default)]
pub(crate) struct Fresh {
    /// Windows the agent acted in that have not drawn since, and when it acted.
    acted: Vec<(WindowId, Instant)>,
    waiting: Vec<Waiting>,
}

impl Fresh {
    /// The agent acted in window `id` at `now`.
    pub(crate) fn acted(&mut self, id: WindowId, now: Instant) {
        self.acted
            .retain(|(window, at)| *window != id && *at + FRESH_WAIT > now);
        self.acted.push((id, now));
    }

    /// Until when a picture of `id` asked at `now` waits; None: it is taken now.
    pub(crate) fn wait_until(&self, id: WindowId, now: Instant) -> Option<Instant> {
        self.acted
            .iter()
            .find(|(window, _)| *window == id)
            .map(|(_, at)| *at + FRESH_WAIT)
            .filter(|until| *until > now)
    }

    /// Window `id` drew: it is fresh, and the pictures that waited for it are due.
    fn drawn(&mut self, id: WindowId) -> Vec<Waiting> {
        self.acted.retain(|(window, _)| *window != id);
        self.take(|waiting| waiting.window == id)
    }

    /// The pictures whose wait is over at `now`, frame or not.
    fn overdue(&mut self, now: Instant) -> Vec<Waiting> {
        self.take(|waiting| waiting.until <= now)
    }

    fn take(&mut self, due: impl Fn(&Waiting) -> bool) -> Vec<Waiting> {
        let (due, rest) = std::mem::take(&mut self.waiting)
            .into_iter()
            .partition(|waiting| due(waiting));
        self.waiting = rest;
        due
    }
}

impl Dashi {
    /// The agent acted in window `id` (`agent-input`, `type-text`): its next picture waits for its next frame.
    pub(crate) fn agent_acted_in(&mut self, id: WindowId) {
        self.agent.fresh.acted(id, Instant::now());
    }

    /// Hold `capture` of window `id` until it draws, or `until`. False: nothing to wait for.
    pub(crate) fn capture_when_fresh(
        &mut self,
        id: WindowId,
        ask: &Ask,
        params: &CaptureParams,
    ) -> bool {
        let now = Instant::now();
        let Some(until) = self.agent.fresh.wait_until(id, now) else {
            return false;
        };
        let timer = smithay::reexports::calloop::timer::Timer::from_deadline(until);
        let armed = self.loop_handle.insert_source(timer, |_, _, state| {
            let due = state.agent.fresh.overdue(Instant::now());
            state.capture_held(due);
            smithay::reexports::calloop::timer::TimeoutAction::Drop
        });
        if armed.is_err() {
            return false;
        }
        // Off screen it must keep hearing frames, or the frame waited for never comes.
        self.agent.away.wake(id, now);
        self.agent.fresh.waiting.push(Waiting {
            window: id,
            until,
            ask: Ask {
                connection: ask.connection,
                id: ask.id,
            },
            params: params.clone(),
        });
        true
    }

    /// Window `id` committed a new buffer: the pictures that waited for it are taken.
    pub(crate) fn window_drew(&mut self, id: WindowId) {
        if self.agent.fresh.acted.is_empty() && self.agent.fresh.waiting.is_empty() {
            return;
        }
        let due = self.agent.fresh.drawn(id);
        self.capture_held(due);
    }

    fn capture_held(&mut self, due: Vec<Waiting>) {
        for waiting in due {
            let ask = waiting.ask;
            if let Err(error) = capture::capture_now(self, &ask, waiting.params) {
                self.ipc.reply(ask.connection, ask.id, Err(error));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn held(window: WindowId, until: Instant) -> Waiting {
        Waiting {
            window,
            until,
            ask: Ask {
                connection: 1,
                id: 1,
            },
            params: serde_json::from_value(serde_json::json!({ "path": "/tmp/x.png" }))
                .expect("capture params"),
        }
    }

    #[test]
    fn a_picture_waits_for_the_frame_after_the_agents_input_and_no_longer_than_the_bound() {
        let mut fresh = Fresh::default();
        let start = Instant::now();
        assert_eq!(fresh.wait_until(3, start), None);
        fresh.acted(3, start);
        let soon = start + Duration::from_millis(20);
        assert_eq!(fresh.wait_until(3, soon), Some(start + FRESH_WAIT));
        // Another window's picture never waits for this one.
        assert_eq!(fresh.wait_until(4, soon), None);
        // Past the bound nothing waits, drawn or not.
        assert_eq!(fresh.wait_until(3, start + FRESH_WAIT), None);
    }

    #[test]
    fn the_windows_frame_frees_its_pictures_and_the_bound_frees_the_rest() {
        let mut fresh = Fresh::default();
        let start = Instant::now();
        fresh.acted(3, start);
        fresh.acted(4, start);
        fresh.waiting.push(held(3, start + FRESH_WAIT));
        fresh.waiting.push(held(4, start + FRESH_WAIT));
        let due = fresh.drawn(3);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].window, 3);
        // Drawn since the input: the next picture is taken at once.
        assert_eq!(fresh.wait_until(3, start + Duration::from_millis(30)), None);
        assert_eq!(fresh.overdue(start + Duration::from_millis(100)).len(), 0);
        let late = fresh.overdue(start + FRESH_WAIT);
        assert_eq!(late.len(), 1);
        assert_eq!(late[0].window, 4);
        assert!(fresh.waiting.is_empty());
    }

    #[test]
    fn typing_again_starts_the_wait_again() {
        let mut fresh = Fresh::default();
        let start = Instant::now();
        fresh.acted(3, start);
        assert!(fresh.drawn(3).is_empty());
        let again = start + Duration::from_millis(40);
        fresh.acted(3, again);
        assert_eq!(fresh.wait_until(3, again), Some(again + FRESH_WAIT));
    }
}
