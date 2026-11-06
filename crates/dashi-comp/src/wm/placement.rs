//! Where a new window goes is the shell's decision (`window-placing`, answered
//! with `place`; src/arrange.ts). A window waits, unmapped, until the shell
//! answers; with no shell listening, or no answer in time, it cascades inside
//! the usable area of the screen under the pointer.

use std::time::Duration;

use serde_json::json;
use smithay::{
    backend::renderer::utils::with_renderer_surface_state,
    desktop::layer_map_for_output,
    reexports::{
        calloop::timer::{TimeoutAction, Timer},
        wayland_server::protocol::wl_surface::WlSurface,
    },
    utils::{Logical, Point, Rectangle, SERIAL_COUNTER},
};

use super::windows::{WindowId, describe, names, toplevel_surface};
use crate::state::Dashi;

/// How long a new window waits for the shell before it is placed anyway.
const PLACING_WAIT: Duration = Duration::from_millis(300);
/// Each fallback window steps this far from the last, wrapping after eight.
const CASCADE: i32 = 32;

impl Dashi {
    /// On a toplevel's commit: once it has drawn, ask the shell where it goes.
    pub(crate) fn place_when_drawn(&mut self, surface: &WlSurface) {
        let drawn =
            with_renderer_surface_state(surface, |state| state.buffer().is_some()).unwrap_or(false);
        let Some(entry) = self.windows.by_surface(surface) else {
            return;
        };
        if entry.placed || entry.placing || !drawn {
            return;
        }
        let id = entry.id;
        self.start_placing(id);
    }

    /// Ask the shell where window `id` goes.
    pub(crate) fn start_placing(&mut self, id: WindowId) {
        let listening = self.ipc.has_subscribers();
        let Some(entry) = self.windows.get_mut(id) else {
            return;
        };
        if entry.placed || entry.placing {
            return;
        }
        if !listening {
            return self.place_fallback(id);
        }
        entry.placing = true;
        let window = entry.window.clone();
        let (app_id, title) = names(&window);
        let asked = window
            .x11_surface()
            .map(|x11| x11.geometry().loc)
            .filter(|at| at.x != 0 || at.y != 0);
        let mut size = window.geometry().size;
        size.h += super::windows::bar_of(self, &window);
        let parent = super::windows::parent_of(self, &window);
        self.ipc.emit(
            "window-placing",
            {
                let mut placing = json!({ "id": id, "appId": app_id, "title": title, "width": size.w, "height": size.h });
                if let Some(at) = asked {
                    placing["position"] = json!({ "x": at.x, "y": at.y });
                }
                if let Some(parent) = parent {
                    placing["parent"] = json!(parent);
                }
                json!({ "window": placing })
            },
        );
        let waited = self.loop_handle.insert_source(
            Timer::from_duration(PLACING_WAIT),
            move |_, _, state| {
                if state.windows.get(id).is_some_and(|entry| !entry.placed) {
                    tracing::debug!(id, "the shell did not place the window in time");
                    state.place_fallback(id);
                }
                TimeoutAction::Drop
            },
        );
        if waited.is_err() {
            self.place_fallback(id);
        }
    }

    /// The shell's answer to `window-placing`: at `at`, on Space `space`
    /// (the one that shows when none is said). On another Space it waits
    /// there, off screen, until that Space shows.
    pub(crate) fn place_window(
        &mut self,
        id: WindowId,
        at: Point<i32, Logical>,
        space: Option<usize>,
    ) -> Result<(), String> {
        if space.is_some_and(|space| space >= self.spaces.count) {
            return Err(format!("no Space {}", space.unwrap_or_default()));
        }
        let entry = self
            .windows
            .get(id)
            .ok_or_else(|| format!("no window {id}"))?;
        if entry.placed {
            // Already on screen (placed by the fallback): a move, then.
            let window = entry.window.clone();
            let activate = self.is_focused(&window);
            self.map_frame_at(&window, at, activate);
            if let Some(space) = space {
                self.move_to_space(id, space)?;
            }
            return Ok(());
        }
        self.finish_placing(id, at, space);
        Ok(())
    }

    fn place_fallback(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get(id) else {
            return;
        };
        let window = entry.window.clone();
        let mut size = window.geometry().size;
        size.h += super::windows::bar_of(self, &window);
        let area = self
            .usable_under_pointer()
            .unwrap_or_else(|| Rectangle::from_size((1280, 800).into()));
        let step = CASCADE * (self.windows.len().saturating_sub(1) % 8) as i32;
        let x = area.loc.x + ((area.size.w - size.w) / 2).max(0) + step;
        let y = area.loc.y + ((area.size.h - size.h) / 4).max(0) + step;
        self.finish_placing(id, (x, y).into(), None);
    }

    fn finish_placing(&mut self, id: WindowId, at: Point<i32, Logical>, space: Option<usize>) {
        let current = self.spaces.current;
        let space = space.unwrap_or(current);
        let Some(entry) = self.windows.get_mut(id) else {
            return;
        };
        entry.placed = true;
        entry.placing = false;
        entry.space = space;
        let window = entry.window.clone();
        if space == current {
            self.map_frame_at(&window, at, true);
        } else {
            // Waiting on its Space, where the slide there draws it.
            let bar = super::windows::bar_of(self, &window);
            if let Some(entry) = self.windows.get_mut(id) {
                entry.away_at = Some((at.x, at.y + bar).into());
            }
            // New, so in front there.
            self.windows.rank_front(id);
        }
        if let Some(x11) = window.x11_surface() {
            let size = window.geometry().size;
            let _ = x11.configure(Rectangle::new(at, size));
        }
        if space == current
            && let (Some(keyboard), Some(surface)) =
                (self.seat.get_keyboard(), toplevel_surface(&window))
        {
            keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
        }
        self.configure_all();
        if let Some(entry) = self.windows.get_mut(id) {
            entry.announced = true;
        }
        if let Some(entry) = self.windows.get(id) {
            let window = describe(entry, self);
            self.ipc.emit("window-opened", json!({ "window": window }));
            self.foreign_opened(id);
        }
    }

    /// The area the menu bar and Dock leave free on the screen under the pointer (global logical).
    pub(crate) fn usable_under_pointer(&self) -> Option<Rectangle<i32, Logical>> {
        let pointer = self.seat.get_pointer()?.current_location().to_i32_round();
        let output = self
            .space
            .outputs()
            .find(|output| {
                self.space
                    .output_geometry(output)
                    .is_some_and(|g| g.contains(pointer))
            })
            .or_else(|| self.space.outputs().next())?;
        let origin = self.space.output_geometry(output)?.loc;
        let mut zone = layer_map_for_output(output).non_exclusive_zone();
        zone.loc += origin;
        Some(zone)
    }
}
