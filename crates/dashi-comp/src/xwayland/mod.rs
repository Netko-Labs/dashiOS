//! Xwayland: X11 apps, as windows like the others. dashi-comp starts the X
//! server (restarting it if it dies) and is its window manager through
//! smithay's X11Wm. X11 windows are placed by the shell like any window
//! (`window-placing`, with the spot the app asked for), report `x11: true`,
//! and share the clipboard and primary selection with Wayland apps. Menus and
//! tooltips (override-redirect windows) go where the app puts them. Its scale
//! (`scale.rs`) is the shell's: above 1, X11 apps draw at the screen's pixels.
//! An app asking for its window back (`_NET_ACTIVE_WINDOW`) is heard on a
//! connection of dashi-comp's own (`activate.rs`).

mod activate;
mod focus;
mod scale;
mod selection;
mod server;
mod state;
mod wm;

use state::RESTART_AFTER;
pub(crate) use state::{XState, Xwayland};
