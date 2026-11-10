//! Which Space a window belongs to, and putting it on or off the screen with its Space.

use crate::wm::windows::{Shown, WindowId};
use crate::{ipc::protocol::Event, state::Dashi};

impl Dashi {
    /// `space-move {window, space}`.
    pub(crate) fn move_to_space(&mut self, id: WindowId, space: usize) -> Result<(), String> {
        if space >= self.spaces.count {
            return Err(format!("no Space {space}"));
        }
        let entry = self
            .windows
            .get(id)
            .filter(|e| e.announced)
            .ok_or_else(|| format!("no window {id}"))?;
        if entry.space == space {
            return Ok(());
        }
        let was_focused = self.is_focused(&entry.window);
        self.space_unmap(id);
        if let Some(entry) = self.windows.get_mut(id) {
            entry.space = space;
        }
        // Put on a Space, it is in front there.
        self.windows.rank_front(id);
        self.space_map(id);
        if was_focused && space != self.spaces.current {
            self.focus_topmost();
        }
        self.ipc.emit(Event::WindowSpace { window: id, space });
        Ok(())
    }

    /// A window activated on another Space: switch there, or bring it here (`follow`).
    pub(crate) fn reach_space_of(&mut self, id: WindowId) {
        let Some(space) = self.windows.get(id).map(|e| e.space) else {
            return;
        };
        if space == self.spaces.current {
            return;
        }
        if self.spaces.follow {
            self.spaces.slide = None;
            self.switch_space_now(space);
        } else {
            let _ = self.move_to_space(id, self.spaces.current);
        }
    }

    /// A window held in a move grab goes to `target` with the switch, and
    /// stays on screen under the pointer (wm/grabs/move_grab.rs).
    pub(super) fn carry_held(&mut self, target: usize) {
        for id in [self.held, self.carried].into_iter().flatten() {
            let Some(entry) = self.windows.get_mut(id) else {
                continue;
            };
            if entry.space == target || entry.shown != Shown::Normal {
                continue;
            }
            entry.space = target;
            self.ipc.emit(Event::window_space(id, target));
        }
    }

    /// Off screen, remembering where (a window on a Space that is not shown).
    pub(super) fn space_unmap(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id) else {
            return;
        };
        if entry.space != self.spaces.current || entry.shown != Shown::Normal || !entry.placed {
            return;
        }
        let window = entry.window.clone();
        let at = self.space.element_location(&window);
        if let Some(entry) = self.windows.get_mut(id) {
            entry.away_at = at;
        }
        self.windows.rank_front(id);
        self.space.unmap_elem(&window);
    }

    /// On screen where it was, if it belongs on the current Space.
    pub(super) fn space_map(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id) else {
            return;
        };
        if entry.space != self.spaces.current || entry.shown != Shown::Normal || !entry.placed {
            return;
        }
        // Carried across: it never left the screen.
        if self.goes_along(id) && self.space.element_location(&entry.window).is_some() {
            return;
        }
        let (window, at) = (entry.window.clone(), entry.away_at);
        if let Some(at) = at {
            crate::wm::actions::x11_follow(&window, at);
            self.space.map_element(window, at, false);
        }
    }
}
