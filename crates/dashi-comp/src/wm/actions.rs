//! What the shell does to windows over IPC: focus, close, minimize, hide,
//! frame, restore. The compositor carries them out; whether to is the shell's
//! decision (docs/compositor-ipc.md, "Session and windows").

use smithay::{
    desktop::Window,
    reexports::wayland_protocols::xdg::shell::server::xdg_toplevel,
    utils::{Logical, Point, Rectangle, SERIAL_COUNTER, Size},
};

use super::windows::{Shown, WindowId, frame_of, toplevel_surface};
use crate::state::Dashi;

/// The smallest frame a request may ask for; anything less is a mistake, not a window.
const MIN_SIZE: i32 = 1;
/// The largest coordinate or size a request may use (logical pixels).
const MAX_COORD: i32 = 1 << 16;

pub(crate) fn valid_frame(
    x: i64,
    y: i64,
    width: i64,
    height: i64,
) -> Option<Rectangle<i32, Logical>> {
    let fits = |v: i64| (-(MAX_COORD as i64)..=MAX_COORD as i64).contains(&v);
    let positive = |v: i64| (MIN_SIZE as i64..=MAX_COORD as i64).contains(&v);
    (fits(x) && fits(y) && positive(width) && positive(height)).then(|| {
        Rectangle::new(
            (x as i32, y as i32).into(),
            (width as i32, height as i32).into(),
        )
    })
}

impl Dashi {
    fn window_of(&self, id: WindowId) -> Result<Window, String> {
        self.windows
            .get(id)
            .filter(|entry| entry.announced || entry.placing)
            .map(|entry| entry.window.clone())
            .ok_or_else(|| format!("no window {id}"))
    }

    /// Put `window`'s frame (its geometry, not its surface, which may carry a
    /// shadow) at `at`: a Space places elements by their geometry's origin.
    pub(crate) fn map_frame_at(
        &mut self,
        window: &Window,
        at: Point<i32, Logical>,
        activate: bool,
    ) {
        let bar = super::windows::bar_of(self, window);
        self.space
            .map_element(window.clone(), (at.x, at.y + bar), activate);
    }

    /// Raise it, give it the keyboard, and bring it back if it was minimized or hidden.
    pub(crate) fn focus_window(&mut self, id: WindowId) -> Result<(), String> {
        let window = self.window_of(id)?;
        self.reach_space_of(id);
        self.show_window(id);
        if !self.on_current_space(id) {
            return Ok(());
        }
        self.space.raise_element(&window, true);
        if let (Some(keyboard), Some(surface)) =
            (self.seat.get_keyboard(), toplevel_surface(&window))
        {
            keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
        }
        self.configure_all();
        Ok(())
    }

    pub(crate) fn close_window(&mut self, id: WindowId) -> Result<(), String> {
        let window = self.window_of(id)?;
        if let Some(toplevel) = window.toplevel() {
            toplevel.send_close();
        }
        Ok(())
    }

    /// Off the screen (minimized or hidden), remembering where it was.
    pub(crate) fn park_window(&mut self, id: WindowId, shown: Shown) -> Result<(), String> {
        let window = self.window_of(id)?;
        let frame = frame_of(self, &window);
        let was_focused = self.is_focused(&window);
        if let Some(entry) = self.windows.get_mut(id) {
            if frame.is_some() {
                entry.parked_at = frame.map(|f| f.loc);
            }
            entry.shown = shown;
        }
        self.space.unmap_elem(&window);
        if was_focused {
            self.focus_topmost();
        }
        Ok(())
    }

    /// Back on screen where it was, if it was parked.
    fn show_window(&mut self, id: WindowId) {
        let Some(entry) = self.windows.get_mut(id) else {
            return;
        };
        if entry.shown == Shown::Normal {
            return;
        }
        entry.shown = Shown::Normal;
        let window = entry.window.clone();
        let at = entry.parked_at.take().unwrap_or_default();
        if entry.space != self.spaces.current {
            // Back, but on a Space that is not shown: it waits there.
            let bar = super::windows::bar_of(self, &window);
            if let Some(entry) = self.windows.get_mut(id) {
                entry.away_at = Some((at.x, at.y + bar).into());
            }
            return;
        }
        self.map_frame_at(&window, at, true);
    }

    /// Move and size its frame. `remember` keeps the frame it had for `restore`
    /// (a tile, a zoom); `maximized` tells the client it is zoomed.
    pub(crate) fn frame_window(
        &mut self,
        id: WindowId,
        frame: Rectangle<i32, Logical>,
        remember: bool,
        maximized: bool,
    ) -> Result<(), String> {
        let window = self.window_of(id)?;
        let current = frame_of(self, &window);
        if let Some(entry) = self.windows.get_mut(id) {
            if remember {
                entry.restore = entry.restore.or(current);
            } else {
                entry.restore = None;
            }
        }
        self.apply_frame(&window, frame, maximized);
        Ok(())
    }

    /// Back to the frame it had before a tile or zoom.
    pub(crate) fn restore_window(&mut self, id: WindowId) -> Result<(), String> {
        let window = self.window_of(id)?;
        self.show_window(id);
        let restore = self
            .windows
            .get_mut(id)
            .and_then(|entry| entry.restore.take());
        if let Some(frame) = restore {
            self.apply_frame(&window, frame, false);
        }
        Ok(())
    }

    /// Size and place a window by its outer frame (title bar included).
    fn apply_frame(&mut self, window: &Window, frame: Rectangle<i32, Logical>, maximized: bool) {
        let bar = super::windows::bar_of(self, window);
        if let Some(toplevel) = window.toplevel() {
            toplevel.with_pending_state(|state| {
                state.size = Some(Size::from((frame.size.w, (frame.size.h - bar).max(1))));
                if maximized {
                    state.states.set(xdg_toplevel::State::Maximized);
                } else {
                    state.states.unset(xdg_toplevel::State::Maximized);
                }
            });
            toplevel.send_pending_configure();
        }
        let activate = self.is_focused(window);
        self.map_frame_at(window, frame.loc, activate);
    }

    pub(crate) fn is_focused(&self, window: &Window) -> bool {
        let surface = toplevel_surface(window);
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| Some(&focus) == surface.as_ref())
    }

    /// The keyboard to the topmost window still on screen, or to nothing.
    pub(crate) fn focus_topmost(&mut self) {
        let topmost = self.space.elements().last().and_then(toplevel_surface);
        if let Some(keyboard) = self.seat.get_keyboard() {
            keyboard.set_focus(self, topmost, SERIAL_COUNTER.next_serial());
        }
        self.configure_all();
    }

    /// Activation changed: tell every client.
    pub(crate) fn configure_all(&self) {
        self.space
            .elements()
            .filter_map(Window::toplevel)
            .for_each(|toplevel| {
                toplevel.send_pending_configure();
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_must_be_real() {
        assert!(valid_frame(10, 20, 800, 600).is_some());
        assert!(valid_frame(-50, 0, 1, 1).is_some());
        assert!(valid_frame(0, 0, 0, 600).is_none());
        assert!(valid_frame(0, 0, 800, -1).is_none());
        assert!(valid_frame(i64::MAX, 0, 800, 600).is_none());
        assert!(valid_frame(0, 0, 1 << 20, 600).is_none());
    }
}
