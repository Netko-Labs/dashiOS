//! Whether copies keep coming (the shell hears `screen-capture {active}`), and
//! the pace of a looping copy: one a refresh, at most `MAX_FPS`.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use smithay::{
    output::Output,
    reexports::calloop::timer::{TimeoutAction, Timer},
};

use crate::{ipc::protocol::Event, state::Dashi};

/// A capture stops counting as active after this long without a copy.
const QUIET: Duration = Duration::from_secs(2);
/// The fastest a looping capture (`copy_with_damage`) is served, whatever the refresh.
const MAX_FPS: u64 = 60;

#[derive(Default)]
pub(crate) struct Activity {
    last_copy: Option<Instant>,
    watching: bool,
    /// When each screen's next paced copy is due, by output name.
    next_paced: HashMap<String, Instant>,
}

impl Activity {
    /// How long a looping copy of `output` waits for its turn: one refresh
    /// (or `MAX_FPS`) after the one before.
    pub(super) fn pace(&mut self, output: &Output, now: Instant) -> Duration {
        let millihertz = output.current_mode().map_or(60_000, |mode| mode.refresh);
        let due = self.next_paced.get(&output.name()).copied();
        let (wait, next) = paced(due, now, frame_interval(millihertz));
        self.next_paced.insert(output.name(), next);
        wait
    }
}

/// One frame at `millihertz` (60 Hz when unknown), never shorter than one at `MAX_FPS`.
fn frame_interval(millihertz: i32) -> Duration {
    let millihertz = u64::try_from(millihertz)
        .ok()
        .filter(|mhz| *mhz > 0)
        .unwrap_or(60_000);
    Duration::from_micros(1_000_000_000 / millihertz)
        .max(Duration::from_micros(1_000_000 / MAX_FPS))
}

/// The wait before a copy whose turn was `due`, and when the one after is due.
fn paced(due: Option<Instant>, now: Instant, interval: Duration) -> (Duration, Instant) {
    let at = due.filter(|due| *due > now).unwrap_or(now);
    (at - now, at + interval)
}

impl Dashi {
    /// A copy went out: the shell hears a capture started, and later that it stopped.
    pub(crate) fn note_capture(&mut self) {
        self.capture_activity.last_copy = Some(Instant::now());
        if self.capture_activity.watching {
            return;
        }
        self.capture_activity.watching = true;
        self.ipc.emit(Event::ScreenCapture { active: true });
        let _ = self
            .loop_handle
            .insert_source(Timer::from_duration(QUIET), |_, _, state| {
                let quiet = state
                    .capture_activity
                    .last_copy
                    .is_none_or(|at| at.elapsed() >= QUIET);
                if !quiet {
                    return TimeoutAction::ToDuration(QUIET);
                }
                state.capture_activity.watching = false;
                state.ipc.emit(Event::ScreenCapture { active: false });
                TimeoutAction::Drop
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looping_copies_wait_one_frame_each() {
        let now = Instant::now();
        let frame = frame_interval(60_000);
        let (wait, next) = paced(None, now, frame);
        assert!(wait.is_zero());
        let (wait, next) = paced(Some(next), now, frame);
        assert_eq!(wait, frame);
        // Late copies don't build up a backlog.
        let later = next + Duration::from_secs(1);
        assert!(paced(Some(next), later, frame).0.is_zero());
    }

    #[test]
    fn fast_screens_are_capped() {
        assert_eq!(
            frame_interval(144_000),
            Duration::from_micros(1_000_000 / MAX_FPS)
        );
        assert_eq!(frame_interval(30_000), Duration::from_micros(33_333));
        assert_eq!(frame_interval(0), frame_interval(60_000));
    }
}
