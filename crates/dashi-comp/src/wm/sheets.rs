//! Sheets: a window attached to another (IPC `attach`), the way a portal's
//! file chooser hangs from the window that asked for it. The shell decides
//! which window is whose sheet; this keeps it there: centred under the
//! parent's title bar (or `top` below its frame's top, where an app draws
//! its own title bar and toolbar: the shell knows how tall), on top of it,
//! on its Space, gone while the parent is
//! off screen, and with the keyboard whenever the parent would get it. A
//! press inside the parent goes to the sheet instead (`sheet_takes_press`).
//! A sheet has no title bar of its own (wm/decor.rs).

use smithay::utils::{Logical, Point};

use super::windows::{WindowId, frame_of, toplevel_surface};
use crate::state::Dashi;

impl Dashi {
    /// Make `child` a sheet of `parent`, hanging `top` below the parent's
    /// frame's top (None: under dashi-comp's title bar), or (no parent) an
    /// ordinary window again.
    pub(crate) fn attach_sheet(
        &mut self,
        child: WindowId,
        parent: Option<WindowId>,
        top: Option<i32>,
    ) -> Result<(), String> {
        if self.windows.get(child).is_none() {
            return Err(format!("no window {child}"));
        }
        if let Some(parent) = parent {
            if parent == child {
                return Err("a window cannot be its own sheet".into());
            }
            let Some(entry) = self.windows.get(parent) else {
                return Err(format!("no window {parent}"));
            };
            if entry.sheet_of.is_some() {
                return Err(format!("window {parent} is itself a sheet"));
            }
        }
        let Some(entry) = self.windows.get_mut(child) else {
            return Err(format!("no window {child}"));
        };
        entry.sheet_of = parent;
        entry.sheet_top = top.filter(|_| parent.is_some());
        entry.title_images.clear();
        let unplaced = !entry.placed;
        if let Some(surface) = toplevel_surface(&entry.window) {
            self.update_decor(&surface);
        }
        if let Some(parent) = parent {
            if unplaced {
                // The first place it goes is its place on the parent.
                let at = self.sheet_spot(child, parent).unwrap_or_default();
                self.place_window(child, at, None)?;
            }
            self.follow_sheets();
            if self
                .windows
                .get(parent)
                .is_some_and(|entry| self.is_focused(&entry.window))
            {
                let _ = self.focus_window(child);
            }
        }
        Ok(())
    }

    /// The sheet on `parent`, if it has one (the newest, if several).
    pub(crate) fn sheet_on(&self, parent: WindowId) -> Option<WindowId> {
        self.windows
            .entries()
            .filter(|entry| entry.sheet_of == Some(parent))
            .map(|entry| entry.id)
            .last()
    }

    /// Where `child`'s frame goes on `parent`: centred, its top at the
    /// parent's content (below dashi-comp's title bar, or `top` below the frame's top).
    fn sheet_spot(&self, child: WindowId, parent: WindowId) -> Option<Point<i32, Logical>> {
        let parent = self.windows.get(parent)?;
        let child = self.windows.get(child)?;
        let frame = frame_of(self, &parent.window)?;
        let bar = child
            .sheet_top
            .unwrap_or_else(|| self.bar_height(&parent.window))
            .clamp(0, (frame.size.h - 1).max(0));
        let width = child.window.geometry().size.w;
        Some(Point::from((
            frame.loc.x + (frame.size.w - width) / 2,
            frame.loc.y + bar,
        )))
    }

    /// After each turn of the loop: every sheet where its parent is, above it, or
    /// off screen with it. A sheet whose parent is gone becomes a window again.
    pub(crate) fn follow_sheets(&mut self) {
        let sheets: Vec<(WindowId, WindowId)> = self
            .windows
            .entries()
            .filter_map(|entry| entry.sheet_of.map(|parent| (entry.id, parent)))
            .collect();
        for (child, parent) in sheets {
            let Some(parent_entry) = self.windows.get(parent) else {
                if let Some(entry) = self.windows.get_mut(child) {
                    entry.sheet_of = None;
                    entry.title_images.clear();
                }
                if let Some(surface) = self
                    .windows
                    .get(child)
                    .and_then(|entry| toplevel_surface(&entry.window))
                {
                    self.update_decor(&surface);
                }
                continue;
            };
            let parent_window = parent_entry.window.clone();
            let parent_space = parent_entry.space;
            let Some(entry) = self.windows.get_mut(child) else {
                continue;
            };
            entry.space = parent_space;
            if !entry.placed {
                continue;
            }
            let child_window = entry.window.clone();
            let parent_shown = self.space.element_location(&parent_window).is_some();
            if !parent_shown {
                if self.space.element_location(&child_window).is_some() {
                    self.space.unmap_elem(&child_window);
                }
                continue;
            }
            let Some(spot) = self.sheet_spot(child, parent) else {
                continue;
            };
            let current = frame_of(self, &child_window).map(|frame| frame.loc);
            if current != Some(spot) {
                let activate = self.is_focused(&child_window);
                self.map_frame_at(&child_window, spot, activate);
            }
            let order: Vec<_> = self.space.elements().cloned().collect();
            let parent_at = order.iter().position(|w| w == &parent_window);
            let child_at = order.iter().position(|w| w == &child_window);
            if let (Some(p), Some(c)) = (parent_at, child_at)
                && c < p
            {
                let activate = self.is_focused(&child_window);
                self.space.raise_element(&child_window, activate);
            }
        }
    }

    /// The sheet that takes a press at `at`: the one on the window under it, if any.
    pub(crate) fn sheet_takes_press(&self, at: Point<f64, Logical>) -> Option<WindowId> {
        let (window, _) = self.space.element_under(at)?;
        let id = self.windows.by_window(window)?.id;
        self.sheet_on(id)
    }
}
