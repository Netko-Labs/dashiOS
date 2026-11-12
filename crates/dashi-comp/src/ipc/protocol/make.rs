//! Events made from the few values their senders have at hand.

use super::{
    events::{Event, SuperPhase},
    window::State,
};

/// What an app (or a taskbar) asks of its window, for the shell to decide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Asked {
    /// Maximized (`zoom`).
    Zoom,
    Fullscreen,
}

impl Asked {
    pub(crate) fn event(self, window: u64, on: bool) -> Event {
        match self {
            Asked::Zoom => Event::Zoom { window, on },
            Asked::Fullscreen => Event::Fullscreen { window, on },
        }
    }
}

impl SuperPhase {
    pub(crate) fn event(self) -> Event {
        Event::Super { phase: self }
    }
}

impl Event {
    /// A chord the keymap binds was pressed: with ⇧, ⌃ and ⌥ as `held`.
    pub(crate) fn binding(
        name: String,
        window: Option<u64>,
        key: String,
        [shift, ctrl, alt]: [bool; 3],
        text: Option<String>,
    ) -> Self {
        Event::Binding {
            name,
            window,
            key,
            shift,
            ctrl,
            alt,
            text,
        }
    }

    /// The Space that shows changed (or how many there are).
    pub(crate) fn space(current: usize, previous: usize, count: usize) -> Self {
        Event::Space {
            current,
            previous,
            count,
        }
    }

    /// A window went to another Space.
    pub(crate) fn window_space(window: u64, space: usize) -> Self {
        Event::WindowSpace { window, space }
    }

    /// A window's state changed (`window-state`).
    pub(crate) fn state(window: u64, state: State) -> Self {
        Event::WindowState { window, state }
    }

    /// A press on a window in the overview became a drag (`drop`: was let go).
    pub(crate) fn overview_drag(window: u64, x: f64, y: f64, drop: bool) -> Self {
        if drop {
            Event::OverviewDrop { window, x, y }
        } else {
            Event::OverviewDrag { window, x, y }
        }
    }
}
