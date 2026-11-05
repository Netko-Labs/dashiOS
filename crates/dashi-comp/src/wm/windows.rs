//! Every toplevel the compositor shows, by the id the shell knows it by: a
//! positive integer, never reused in a session (docs/compositor-ipc.md).

use serde_json::{Value, json};
use smithay::{
    desktop::Window,
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Point, Rectangle, Size},
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
    pub(crate) fn name(self) -> &'static str {
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
    /// The client was last told it is maximized (`frame` with `maximized`: the shell's Fill).
    pub maximized: bool,
    /// The shell framed it as a tile (`frame` with `tiled`), until another
    /// frame, Fill, full screen, or the person moves or resizes it: its
    /// depth is a tile's (render/depth/).
    pub tiled: bool,
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
    /// Its place in its Space's stack while that Space is not shown (higher
    /// is nearer the front): stamped as it leaves the screen, so the Space
    /// comes back, slides in, and is pictured in the order it had.
    pub away_rank: u64,
    /// It asked for focus and was refused; cleared when it gets the keyboard.
    pub attention: bool,
    /// The title bar control under the pointer, if any (the controls light up).
    pub hover: Option<crate::render::titlebar::Part>,
    /// Its icon (xdg-toplevel-icon), as last told.
    pub icon: crate::handlers::toplevel_meta::Icon,
    /// The window it is a sheet of (IPC `attach`; wm/sheets.rs).
    pub sheet_of: Option<WindowId>,
    /// As a sheet: how far below the top of its parent's frame it hangs
    /// (`attach {top}`: an app's own title bar and toolbar); None is under
    /// the title bar dashi-comp draws.
    pub sheet_top: Option<i32>,
    /// When it last got the person's keyboard (a count, higher is later; 0 never).
    pub used: u64,
    /// Its shadow and edge as last drawn (render/depth/).
    pub depth: crate::render::depth::Cache,
}

pub(crate) struct Windows {
    entries: Vec<Entry>,
    next_id: WindowId,
    /// The last `used` stamp given.
    used: u64,
    /// The last `away_rank` given.
    ranked: u64,
}

impl Default for Windows {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
            next_id: 1,
            used: 0,
            ranked: 0,
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
            maximized: false,
            tiled: false,
            decor: Decor::None,
            unified: false,
            title_image: None,
            fullscreen: None,
            space: 0,
            away_at: None,
            away_rank: 0,
            attention: false,
            icon: Default::default(),
            hover: None,
            sheet_of: None,
            sheet_top: None,
            used: 0,
            depth: Default::default(),
        });
        id
    }

    /// The window whose toplevel is `surface` got the person's keyboard: it is the most recently used.
    pub(crate) fn used(&mut self, surface: &WlSurface) {
        self.used += 1;
        let stamp = self.used;
        if let Some(entry) = self.by_surface_mut(surface) {
            entry.used = stamp;
        }
    }

    /// Window `id` waits in front of the others on its Space (it left the screen last, or was put there).
    pub(crate) fn rank_front(&mut self, id: WindowId) {
        self.ranked += 1;
        let rank = self.ranked;
        if let Some(entry) = self.get_mut(id) {
            entry.away_rank = rank;
        }
    }

    /// The windows waiting on Space `space` that show (not minimized or hidden), back to front.
    pub(crate) fn waiting_on(&self, space: usize) -> Vec<&Entry> {
        let mut waiting: Vec<&Entry> = self
            .entries
            .iter()
            .filter(|entry| entry.space == space && entry.shown == Shown::Normal)
            .collect();
        waiting.sort_by_key(|entry| entry.away_rank);
        waiting
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

    pub(crate) fn by_window_mut(&mut self, window: &Window) -> Option<&mut Entry> {
        self.entries
            .iter_mut()
            .find(|entry| &entry.window == window)
    }

    pub(crate) fn entries_mut(&mut self) -> impl Iterator<Item = &mut Entry> {
        self.entries.iter_mut()
    }

    pub(crate) fn remove(&mut self, id: WindowId) -> Option<Entry> {
        let at = self.entries.iter().position(|entry| entry.id == id)?;
        Some(self.entries.remove(at))
    }

    /// The announced windows as the shell sees them, front to back: those
    /// that show, most recently used first, then the minimized, then the
    /// hidden (each latest first); never used, newest first.
    pub(crate) fn describe_all(&self, state: &Dashi) -> Vec<Value> {
        let mut listed: Vec<&Entry> = self.entries.iter().filter(|e| e.announced).collect();
        listed.sort_by_key(|e| (recency_group(e.shown), std::cmp::Reverse((e.used, e.id))));
        listed.into_iter().map(|e| describe(e, state)).collect()
    }
}

/// Where windows in each state come in the list: on screen, minimized, hidden.
fn recency_group(shown: Shown) -> u8 {
    match shown {
        Shown::Normal => 0,
        Shown::Minimized => 1,
        Shown::Hidden => 2,
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

/// Its frame as it is about to be: where it is, at the size it is being
/// configured to while its app has not drawn that yet.
pub(crate) fn frame_to_be(state: &Dashi, window: &Window) -> Option<Rectangle<i32, Logical>> {
    let frame = frame_of(state, window)?;
    Some(configuring(state, window).map_or(frame, |size| Rectangle::new(frame.loc, size)))
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
        "frame": frame,
        "configuring": configuring(state, &entry.window).map(|size| json!({ "width": size.w, "height": size.h })),
        "titleBar": state.bar_height(&entry.window),
        "fullscreen": entry.fullscreen.is_some(),
        "space": entry.space,
        "attention": entry.attention,
        "x11": entry.window.x11_surface().is_some(),
        "sheetOf": entry.sheet_of,
        "parent": parent_of(state, &entry.window),
        "icon": (entry.icon.name.is_some() || entry.icon.path.is_some())
            .then(|| json!({ "name": entry.icon.name, "path": entry.icon.path })),
        "toplevel": state.toplevel_list.as_ref().and_then(|list| list.identifier_of(entry.id)),
    })
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

pub(crate) fn rect_json(rect: Rectangle<i32, Logical>) -> Value {
    json!({ "x": rect.loc.x, "y": rect.loc.y, "width": rect.size.w, "height": rect.size.h })
}
