//! Every toplevel the compositor shows, by the id the shell knows it by: a
//! positive integer, never reused in a session (docs/compositor-ipc.md).

mod entry;
mod helper;
mod lookup;

use smithay::{desktop::Window, reexports::wayland_server::protocol::wl_surface::WlSurface};

pub(crate) use self::{
    entry::Entry,
    helper::{pid_of, window_for_copy},
    lookup::{names, parent_of, toplevel_surface, window_id_for_surface},
};
pub(crate) use super::describe::describe;
use crate::{ipc::protocol, render::titlebar::Decor, state::Dashi};

pub(crate) type WindowId = u64;

/// Whether a window shows, as the shell sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shown {
    Normal,
    Minimized,
    Hidden,
}

impl Shown {
    /// As the IPC says it.
    pub(crate) fn wire(self) -> protocol::State {
        match self {
            Shown::Normal => protocol::State::Normal,
            Shown::Minimized => protocol::State::Minimized,
            Shown::Hidden => protocol::State::Hidden,
        }
    }
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
            title_images: Default::default(),
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
    pub(crate) fn describe_all(&self, state: &Dashi) -> Vec<protocol::Window> {
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
