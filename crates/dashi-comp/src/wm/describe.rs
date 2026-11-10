//! A window as the IPC says it (`Window`, docs/compositor-ipc.md): in the
//! `windows` reply and the `window-opened` event.

use smithay::reexports::wayland_server::Resource;

use super::{
    geometry::{configuring, frame_of, min_frame},
    windows::{Entry, names, parent_of, toplevel_surface},
};
use crate::{
    ipc::protocol::{self, Extent, Frame, Icon},
    state::Dashi,
};

/// A window in the IPC's `Window` shape.
pub(crate) fn describe(entry: &Entry, state: &Dashi) -> protocol::Window {
    let surface = toplevel_surface(&entry.window);
    let (app_id, title) = names(&entry.window);
    // Xwayland is one client for every X11 app: an X11 window says its own (_NET_WM_PID).
    let pid = match entry.window.x11_surface() {
        Some(x11) => x11.pid().map(|pid| pid as i32),
        None => surface
            .as_ref()
            .and_then(|surface| state.display_handle.get_client(surface.id()).ok())
            .and_then(|client| client.get_credentials(&state.display_handle).ok())
            .map(|credentials| credentials.pid),
    };
    let focused = state
        .seat
        .get_keyboard()
        .and_then(|keyboard| keyboard.current_focus())
        .is_some_and(|focus| Some(&focus) == surface.as_ref());
    protocol::Window {
        id: entry.id,
        app_id,
        title,
        pid,
        focused,
        state: entry.shown.wire(),
        frame: frame_of(state, &entry.window).map(Frame::from),
        configuring: configuring(state, &entry.window).map(Extent::from),
        min_size: min_frame(state, &entry.window).map(Extent::from),
        title_bar: state.bar_height(&entry.window),
        fullscreen: entry.fullscreen.is_some(),
        space: entry.space,
        attention: entry.attention,
        x11: entry.window.x11_surface().is_some(),
        sheet_of: entry.sheet_of,
        parent: parent_of(state, &entry.window),
        icon: (entry.icon.name.is_some() || entry.icon.path.is_some()).then(|| Icon {
            name: entry.icon.name.clone(),
            path: entry
                .icon
                .path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
        }),
        toplevel: state
            .toplevel_list
            .as_ref()
            .and_then(|list| list.identifier_of(entry.id)),
    }
}
