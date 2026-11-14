//! A window's outer frame: where it is, its title bar, the size it is being
//! configured to, and the smallest its app allows.

use smithay::{
    desktop::Window,
    utils::{Logical, Rectangle, Size},
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use crate::state::Dashi;

/// The window's frame on screen (global logical), None while it is not mapped.
/// The window's outer frame on screen (title bar included, global logical),
/// None while it is not mapped.
pub(crate) fn frame_of(state: &Dashi, window: &Window) -> Option<Rectangle<i32, Logical>> {
    let mut frame = state.space.element_geometry(window)?;
    let bar = bar_of(state, window);
    frame.loc.y -= bar;
    frame.size.h += bar;
    Some(frame)
}

/// The outer frame a window has where it waits on a Space that does not show (as `frame_of`
/// gives it on screen); None on screen, minimized or hidden.
pub(crate) fn away_frame(state: &Dashi, window: &Window) -> Option<Rectangle<i32, Logical>> {
    let id = state.windows.by_window(window)?.id;
    let (_, mut frame) = crate::session::agent_away::away_content(state, id)?;
    let bar = bar_of(state, window);
    frame.loc.y -= bar;
    frame.size.h += bar;
    Some(frame)
}

/// The height of the title bar dashi-comp draws above `window` (0 for none).
pub(crate) fn bar_of(state: &Dashi, window: &Window) -> i32 {
    state.bar_height(window)
}

/// The outer size an xdg window was last asked to take (`frame`, full
/// screen, a resize), while its app has not yet acked and committed that
/// configure: until then its frame still has the old size. None once it has
/// (whatever size it then chose), and for X11 windows, which take a size at once.
pub(crate) fn configuring(state: &Dashi, window: &Window) -> Option<Size<i32, Logical>> {
    let toplevel = window.toplevel()?;
    let in_flight = with_states(toplevel.wl_surface(), |states| {
        states
            .data_map
            .get::<XdgToplevelSurfaceData>()
            .and_then(|data| data.lock().ok())
            .is_some_and(|data| {
                !data.pending_configures().is_empty()
                    || data.configure_serial != data.current_serial
            })
    });
    if !in_flight {
        return None;
    }
    let size = toplevel.with_pending_state(|pending| pending.size)?;
    Some(Size::from((size.w, size.h + bar_of(state, window))))
}

/// The smallest outer frame its app allows (xdg `set_min_size`, X11's
/// `WM_NORMAL_HINTS`), title bar included; None when it sets no minimum.
/// The shell keeps the frames it asks for at least this big.
pub(crate) fn min_frame(state: &Dashi, window: &Window) -> Option<Size<i32, Logical>> {
    let (least, _) = super::grabs::resize_grab::size_limits(window);
    (least.w > 0 || least.h > 0)
        .then(|| Size::from((least.w.max(1), least.h.max(1) + bar_of(state, window))))
}

/// Its frame as it is about to be: where it is, at the size it is being
/// configured to while its app has not drawn that yet.
pub(crate) fn frame_to_be(state: &Dashi, window: &Window) -> Option<Rectangle<i32, Logical>> {
    let frame = frame_of(state, window)?;
    Some(configuring(state, window).map_or(frame, |size| Rectangle::new(frame.loc, size)))
}
