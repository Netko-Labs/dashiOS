//! What an agent has going in windows on Spaces that do not show
//! (session/agent_away.rs): its pointer in one, and the windows kept drawing.

use std::time::{Duration, Instant};

use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;

use crate::wm::WindowId;

/// How long a window an agent acted in or looked at keeps hearing frames off screen.
const AWAKE_FOR: Duration = Duration::from_secs(10);

/// The agent's pointer inside a window that is off screen.
pub(crate) struct AwayPointer {
    pub(super) surface: WlSurface,
    pub(super) buttons: Vec<u32>,
    /// The person's pointer left this client for it, and comes back when this ends.
    pub(super) aside: bool,
}

/// What an agent has going in windows that are off screen.
#[derive(Default)]
pub(crate) struct Away {
    pub(super) pointer: Option<AwayPointer>,
    /// Windows that keep drawing off screen (frames.rs), and until when.
    awake: Vec<(WindowId, Instant)>,
}

impl Away {
    /// Whether the person's pointer stands aside now: it must not enter what is under it.
    pub(crate) fn pointer_aside(&self) -> bool {
        self.pointer.as_ref().is_some_and(|pointer| pointer.aside)
    }

    /// Window `id` keeps drawing for a while: an agent acted in it or looked at it.
    pub(crate) fn wake(&mut self, id: WindowId, now: Instant) {
        self.awake
            .retain(|(window, until)| *window != id && *until > now);
        self.awake.push((id, now + AWAKE_FOR));
    }

    /// The windows kept drawing at `now`.
    pub(crate) fn awake(&self, now: Instant) -> impl Iterator<Item = WindowId> + '_ {
        self.awake
            .iter()
            .filter(move |(_, until)| *until > now)
            .map(|(id, _)| *id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_stays_awake_a_while_after_the_agent_touched_it() {
        let mut away = Away::default();
        let start = Instant::now();
        away.wake(3, start);
        away.wake(4, start);
        away.wake(3, start + Duration::from_secs(5));
        let at = |after: u64| start + Duration::from_secs(after);
        let mut awake: Vec<_> = away.awake(at(9)).collect();
        awake.sort_unstable();
        assert_eq!(awake, [3, 4]);
        assert_eq!(away.awake(at(11)).collect::<Vec<_>>(), [3]);
        assert_eq!(away.awake(at(16)).count(), 0);
        assert!(!away.pointer_aside());
    }
}
