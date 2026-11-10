//! The window a helper process works for. An app that copies through
//! `wl-copy` (Dashi's apps do: apps/kit's clipboard) has no data-control, so
//! wl-copy maps a 1×1 surface of its own to take the keyboard and set the
//! clipboard; the keyboard's surface is then not a window. The helper runs in
//! its app's session (an app the shell starts leads a session of its own), so
//! the copy is the app's: its window there that was used last.

use smithay::reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface};

use super::{Entry, WindowId, toplevel_surface};
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

/// The window the client of `surface` (not a window itself) works for: the
/// last used window in its process's session; None when it has none there.
pub(crate) fn window_for_helper(state: &Dashi, surface: &WlSurface) -> Option<WindowId> {
    let helper = surface.client()?.get_data::<ClientState>()?.pid?;
    let session = session_of(helper)?;
    let windows = state
        .windows
        .entries()
        .filter(|entry| entry.announced)
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
    fn a_helper_works_for_the_last_used_window_in_its_session() {
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
    fn a_helper_with_no_window_in_its_session_works_for_none() {
        let windows = [(1, Some(40), 3), (4, None, 99)];
        assert_eq!(last_used_in(60, windows.into_iter()), None);
        assert_eq!(last_used_in(60, std::iter::empty()), None);
    }
}
