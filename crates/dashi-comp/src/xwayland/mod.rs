//! Xwayland: X11 apps, as windows like the others. dashi-comp starts the X
//! server (restarting it if it dies) and is its window manager through
//! smithay's X11Wm. X11 windows are placed by the shell like any window
//! (`window-placing`, with the spot the app asked for), report `x11: true`,
//! and share the clipboard and primary selection with Wayland apps. Menus and
//! tooltips (override-redirect windows) go where the app puts them.

mod focus;
mod server;
mod wm;

use smithay::xwayland::{X11Surface, X11Wm};

/// Xwayland that dies is started again, after waiting longer each time.
pub(super) const RESTART_AFTER: [u64; 4] = [1, 2, 5, 15];

/// Where Xwayland is, as `session` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum XState {
    #[default]
    Off,
    Starting,
    Ready,
    Failed,
}

impl XState {
    pub(crate) fn name(self) -> &'static str {
        match self {
            XState::Off => "off",
            XState::Starting => "starting",
            XState::Ready => "ready",
            XState::Failed => "failed",
        }
    }
}

#[derive(Default)]
pub(crate) struct Xwayland {
    pub state: XState,
    /// The X display apps reach it on, while it runs.
    pub display: Option<u32>,
    /// The display number it was given, kept for restarts.
    pub number: Option<u32>,
    pub wm: Option<X11Wm>,
    /// The X11 window with the keyboard.
    focused: Option<X11Surface>,
    restarts: usize,
}
