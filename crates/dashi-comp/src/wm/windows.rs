//! Every toplevel the compositor shows, by the id the shell knows it by: a
//! positive integer, never reused in a session (docs/compositor-ipc.md).

use serde_json::{Value, json};
use smithay::{
    desktop::Window,
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Point, Rectangle},
    wayland::{compositor::with_states, shell::xdg::XdgToplevelSurfaceData},
};

use crate::{
    render::titlebar::{self, Decor},
    state::Dashi,
};

pub(crate) type WindowId = u64;

/// Whether a window shows, as the shell sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shown {
    Normal,
    Minimized,
    Hidden,
}

impl Shown {
    fn name(self) -> &'static str {
        match self {
            Shown::Normal => "normal",
            Shown::Minimized => "minimized",
            Shown::Hidden => "hidden",
        }
    }
}

pub(crate) struct Entry {
    pub id: WindowId,
    pub window: Window,
    /// The shell has been told about it (`window-opened`): it is placed and has drawn something.
    pub announced: bool,
    /// Placed on screen (by the shell's `place`, or the fallback); until then it is not mapped.
    pub placed: bool,
    /// `window-placing` went out; waiting for the shell's answer.
    pub placing: bool,
    pub shown: Shown,
    /// Where its frame was when it last left the screen (minimized, hidden).
    pub parked_at: Option<Point<i32, Logical>>,
    /// The frame to go back to (`restore`) after a tile or zoom (`frame` with `remember`).
    pub restore: Option<Rectangle<i32, Logical>>,
    /// How it is framed: by the client, by dashi-comp's title bar, or unified.
    pub decor: Decor,
    /// The app asked for the unified style (dashi-chrome-v1).
    pub unified: bool,
    /// The title bar (or a unified window's lights) as last drawn.
    pub title_image: Option<titlebar::Image>,
    /// Full screen on this output, and the outer frame to go back to.
    pub fullscreen: Option<(String, Rectangle<i32, Logical>)>,
    /// The Space it is on.
    pub space: usize,
    /// Where it was while its Space is not shown.
    pub away_at: Option<Point<i32, Logical>>,
    /// It asked for focus and was refused; cleared when it gets the keyboard.
    pub attention: bool,
    /// The title bar control under the pointer, if any (the controls light up).
    pub hover: Option<crate::render::titlebar::Part>,
    /// Its icon (xdg-toplevel-icon), as last told.
    pub icon: crate::handlers::toplevel_meta::Icon,
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
            placed: false,
            placing: false,
            shown: Shown::Normal,
            parked_at: None,
            restore: None,
            decor: Decor::None,
            unified: false,
            title_image: None,
            fullscreen: None,
            space: 0,
            away_at: None,
            attention: false,
            icon: Default::default(),
            hover: None,
        });
        id
    }

    pub(crate) fn ids(&self) -> impl Iterator<Item = WindowId> + use<> {
        self.entries
            .iter()
            .map(|entry| entry.id)
            .collect::<Vec<_>>()
            .into_iter()
    }

    pub(crate) fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter()
    }

    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn get(&self, id: WindowId) -> Option<&Entry> {
        self.entries.iter().find(|entry| entry.id == id)
    }

    pub(crate) fn get_mut(&mut self, id: WindowId) -> Option<&mut Entry> {
        self.entries.iter_mut().find(|entry| entry.id == id)
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

    pub(crate) fn by_window(&self, window: &Window) -> Option<&Entry> {
        self.entries.iter().find(|entry| &entry.window == window)
    }

    pub(crate) fn entries_mut(&mut self) -> impl Iterator<Item = &mut Entry> {
        self.entries.iter_mut()
    }

    pub(crate) fn remove(&mut self, id: WindowId) -> Option<Entry> {
        let at = self.entries.iter().position(|entry| entry.id == id)?;
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

/// The height of the title bar dashi-comp draws above `window` (0 for none).
pub(crate) fn bar_of(state: &Dashi, window: &Window) -> i32 {
    state.bar_height(window)
}

/// A window in the IPC's `Window` shape.
pub(crate) fn describe(entry: &Entry, state: &Dashi) -> Value {
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
    let frame = frame_of(state, &entry.window).map(rect_json);
    json!({
        "id": entry.id,
        "appId": app_id,
        "title": title,
        "pid": pid,
        "focused": focused,
        "state": entry.shown.name(),
        "zoomed": entry.restore.is_some(),
        "frame": frame,
        "titleBar": state.bar_height(&entry.window),
        "fullscreen": entry.fullscreen.is_some(),
        "space": entry.space,
        "attention": entry.attention,
        "x11": entry.window.x11_surface().is_some(),
        "icon": (entry.icon.name.is_some() || entry.icon.path.is_some())
            .then(|| json!({ "name": entry.icon.name, "path": entry.icon.path })),
    })
}

pub(crate) fn rect_json(rect: Rectangle<i32, Logical>) -> Value {
    json!({ "x": rect.loc.x, "y": rect.loc.y, "width": rect.size.w, "height": rect.size.h })
}
