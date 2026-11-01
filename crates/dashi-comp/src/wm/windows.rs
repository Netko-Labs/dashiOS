//! Every toplevel the compositor shows, by the id the shell knows it by: a
//! positive integer, never reused in a session (docs/compositor-ipc.md).

use serde_json::{Value, json};
use smithay::{
    desktop::Window,
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use crate::state::Dashi;

pub(crate) type WindowId = u64;

pub(crate) struct Entry {
    pub id: WindowId,
    pub window: Window,
    /// The shell has been told about it (`window-opened`): it has drawn something.
    pub announced: bool,
}

pub(crate) struct Windows {
    entries: Vec<Entry>,
    next_id: WindowId,
}

impl Default for Windows {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
        }
    }
}

impl Windows {
    pub(crate) fn add(&mut self, window: Window) -> WindowId {
        let id = self.next_id;
        self.next_id += 1;
        self.entries.push(Entry {
            id,
            window,
            announced: false,
        });
        id
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn by_surface(&self, surface: &WlSurface) -> Option<&Entry> {
        self.entries
            .iter()
            .find(|entry| toplevel_surface(&entry.window).as_ref() == Some(surface))
    }

    pub(crate) fn by_surface_mut(&mut self, surface: &WlSurface) -> Option<&mut Entry> {
        self.entries
            .iter_mut()
            .find(|entry| toplevel_surface(&entry.window).as_ref() == Some(surface))
    }

    pub(crate) fn remove_surface(&mut self, surface: &WlSurface) -> Option<Entry> {
        let at = self
            .entries
            .iter()
            .position(|entry| toplevel_surface(&entry.window).as_ref() == Some(surface))?;
        Some(self.entries.remove(at))
    }

    /// The announced windows as the shell sees them, oldest first.
    pub(crate) fn describe_all(&self, state: &Dashi) -> Vec<Value> {
        self.entries
            .iter()
            .filter(|entry| entry.announced)
            .map(|entry| describe(entry, state))
            .collect()
    }
}

fn toplevel_surface(window: &Window) -> Option<WlSurface> {
    window
        .toplevel()
        .map(|toplevel| toplevel.wl_surface().clone())
}

/// A window in the IPC's `Window` shape.
pub(crate) fn describe(entry: &Entry, state: &Dashi) -> Value {
    let surface = toplevel_surface(&entry.window);
    let (app_id, title) = surface
        .as_ref()
        .map(|surface| {
            with_states(surface, |states| {
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
        .unwrap_or_default();
    let pid = surface
        .as_ref()
        .and_then(|surface| state.display_handle.get_client(surface.id()).ok())
        .and_then(|client| client.get_credentials(&state.display_handle).ok())
        .map(|credentials| credentials.pid);
    let focused = state
        .seat
        .get_keyboard()
        .and_then(|keyboard| keyboard.current_focus())
        .is_some_and(|focus| Some(&focus) == surface.as_ref());
    let frame = state.space.element_geometry(&entry.window).map(|geometry| {
        json!({ "x": geometry.loc.x, "y": geometry.loc.y, "width": geometry.size.w, "height": geometry.size.h })
    });
    json!({
        "id": entry.id,
        "appId": app_id,
        "title": title,
        "pid": pid,
        "focused": focused,
        "state": "normal",
        "zoomed": false,
        "frame": frame,
        "titleBar": 0,
    })
}
