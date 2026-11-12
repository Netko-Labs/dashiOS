//! The window a copy comes from. An app that copies through `wl-copy`
//! (Dashi's apps do: apps/kit's clipboard) has no data-control, so wl-copy
//! maps a 1×1 window of its own for a moment, to take the keyboard and set
//! the clipboard. That window is gone by the time the shell looks; the copy
//! is the app's. wl-copy runs in its app's session (an app the shell starts
//! leads a session of its own), so it is the app's window there used last.

use smithay::reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface};

use super::{Entry, WindowId, names, toplevel_surface, window_id_for_surface};
use crate::{
    session::trust::session_of,
    state::{ClientState, Dashi},
};

/// The pid of the process that draws `entry`: an X11 window's own
/// (_NET_WM_PID, Xwayland being one client for all of them), else its client's.
pub(crate) fn pid_of(entry: &Entry, state: &Dashi) -> Option<i32> {
    match entry.window.x11_surface() {
        Some(x11) => x11.pid().map(|pid| pid as i32),
        None => toplevel_surface(&entry.window)
            .and_then(|surface| state.display_handle.get_client(surface.id()).ok())
            .and_then(|client| client.get_credentials(&state.display_handle).ok())
            .map(|credentials| credentials.pid),
    }
}

/// wl-clipboard's app id, on the window wl-copy maps when it has no data-control.
const WL_CLIPBOARD: &str = "io.github.bugaevc.wl-clipboard";

/// The window a copy made while `focus` had the keyboard comes from: that
/// window; or, when it is wl-copy's, the last used other window in wl-copy's
/// session (None when there is none).
pub(crate) fn window_for_copy(state: &Dashi, focus: &WlSurface) -> Option<WindowId> {
    let own = window_id_for_surface(state, focus);
    let helper = state
        .windows
        .by_surface(focus)
        .is_some_and(|entry| names(&entry.window).0 == WL_CLIPBOARD);
    if !helper {
        return own;
    }
    let pid = focus.client()?.get_data::<ClientState>()?.pid?;
    let session = session_of(pid)?;
    let windows = state
        .windows
        .entries()
        .filter(|entry| entry.announced && Some(entry.id) != own)
        .map(|entry| {
            (
                entry.id,
                pid_of(entry, state).and_then(session_of),
                entry.used,
            )
        });
    last_used_in(session, windows)
}

/// Of `windows` (id, session, last used), the last used one in `session`.
fn last_used_in(
    session: i32,
    windows: impl Iterator<Item = (WindowId, Option<i32>, u64)>,
) -> Option<WindowId> {
    windows
        .filter(|(_, theirs, _)| *theirs == Some(session))
        .max_by_key(|(_, _, used)| *used)
        .map(|(id, _, _)| id)
}

#[cfg(test)]
mod tests {
    use super::last_used_in;

    #[test]
    fn a_copy_through_wl_copy_is_the_last_used_window_in_its_session_the_last_used_window_in_its_session()
     {
        let windows = [
            (1, Some(40), 3),
            (2, Some(50), 9),
            (3, Some(40), 7),
            (4, None, 99),
        ];
        assert_eq!(last_used_in(40, windows.into_iter()), Some(3));
        assert_eq!(last_used_in(50, windows.into_iter()), Some(2));
    }

    #[test]
    fn a_copy_through_wl_copy_with_no_window_in_its_session_has_none() {
        let windows = [(1, Some(40), 3), (4, None, 99)];
        assert_eq!(last_used_in(60, windows.into_iter()), None);
        assert_eq!(last_used_in(60, std::iter::empty()), None);
    }
}
