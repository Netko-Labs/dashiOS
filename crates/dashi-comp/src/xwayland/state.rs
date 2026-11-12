//! Where Xwayland is: its state, its display, its window manager, and what
//! a restart keeps.

use smithay::{
    reexports::wayland_server::Client,
    xwayland::{X11Surface, X11Wm},
};

/// Xwayland that dies is started again, after waiting longer each time.
pub(super) const RESTART_AFTER: [u64; 4] = [1, 2, 5, 15];

/// Where Xwayland is, as `session` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum XState {
    #[default]
    Off,
    Starting,
    Ready,
    Failed,
}

pub(crate) struct Xwayland {
    pub state: XState,
    /// The X display apps reach it on, while it runs.
    pub display: Option<u32>,
    /// The display number it was given, kept for restarts.
    pub number: Option<u32>,
    pub wm: Option<X11Wm>,
    /// The X11 window with the keyboard.
    pub(super) focused: Option<X11Surface>,
    pub(super) restarts: usize,
    /// Xwayland's own Wayland connection, while it runs.
    pub(super) client: Option<Client>,
    /// X11 pixels per logical pixel (IPC `xwayland-scale`); kept for restarts.
    pub(super) scale: f64,
}

impl Default for Xwayland {
    fn default() -> Self {
        Self {
            state: XState::Off,
            display: None,
            number: None,
            wm: None,
            focused: None,
            restarts: 0,
            client: None,
            scale: 1.0,
        }
    }
}
