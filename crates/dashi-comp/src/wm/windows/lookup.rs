//! Finding windows and their names: a toplevel's surface, its id, app id and title, its parent.

use smithay::{
    desktop::Window,
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use super::WindowId;
use crate::state::Dashi;

pub(crate) fn toplevel_surface(window: &Window) -> Option<WlSurface> {
    smithay::wayland::seat::WaylandFocus::wl_surface(window).map(std::borrow::Cow::into_owned)
}

/// The id of the window whose toplevel is `surface`, if it is one the shell knows.
pub(crate) fn window_id_for_surface(state: &Dashi, surface: &WlSurface) -> Option<WindowId> {
    state
        .windows
        .by_surface(surface)
        .filter(|entry| entry.announced)
        .map(|entry| entry.id)
}

/// A window's app id and title, as its client last set them.
pub(crate) fn names(window: &Window) -> (String, String) {
    if let Some(x11) = window.x11_surface() {
        return (x11.class(), x11.title());
    }
    window
        .toplevel()
        .map(|toplevel| toplevel.wl_surface().clone())
        .map(|surface| {
            with_states(&surface, |states| {
                states
                    .data_map
                    .get::<XdgToplevelSurfaceData>()
                    .and_then(|data| data.lock().ok())
                    .map(|data| {
                        (
                            data.app_id.clone().unwrap_or_default(),
                            data.title.clone().unwrap_or_default(),
                        )
                    })
                    .unwrap_or_default()
            })
        })
        .unwrap_or_default()
}

/// The window `window` is a dialog of: its xdg parent, or the X11 window it
/// is transient for; None for a window of its own (or one the shell does not know).
pub(crate) fn parent_of(state: &Dashi, window: &Window) -> Option<WindowId> {
    if let Some(x11) = window.x11_surface() {
        let owner = x11.is_transient_for()?;
        return state
            .windows
            .entries()
            .find(|entry| {
                entry
                    .window
                    .x11_surface()
                    .is_some_and(|x| x.window_id() == owner)
            })
            .map(|entry| entry.id);
    }
    let parent = window.toplevel()?.parent()?;
    window_id_for_surface(state, &parent)
}
