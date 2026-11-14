//! What the shell does to windows over IPC: focus, close, minimize, hide,
//! frame. The compositor carries them out; whether to is the shell's
//! decision (docs/compositor-ipc.md, "Session and windows"). Which frame a
//! window had before it was tiled or filled is the shell's to remember too.

mod framing;
mod parking;

use smithay::{
    desktop::Window,
    utils::{Logical, Point, Rectangle, SERIAL_COUNTER},
};

use super::{WindowId, toplevel_surface};
use crate::{ipc::protocol::Event, state::Dashi};

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
        let bar = super::geometry::bar_of(self, window);
        self.space
            .map_element(window.clone(), (at.x, at.y + bar), activate);
        x11_follow(window, (at.x, at.y + bar).into());
    }

    /// Raise it, give it the keyboard, and bring it back if it was minimized or hidden.
    pub(crate) fn focus_window(&mut self, id: WindowId) -> Result<(), String> {
        let window = self.window_of(id)?;
        self.reach_space_of(id);
        self.show_window(id);
        if !self.on_current_space(id) {
            return Ok(());
        }
        // A window with a sheet on it gives the sheet the keyboard (wm/sheets.rs).
        let window = match self
            .sheet_on(id)
            .and_then(|sheet| self.window_of(sheet).ok())
        {
            Some(sheet) => {
                self.space.raise_element(&window, false);
                sheet
            }
            None => window,
        };
        // While locked it is raised but neither active nor given the keyboard,
        // which stays on the lock screen; the unlock gives it the keyboard
        // as the window in front (session/lock.rs).
        let locked = self.lock.locked;
        self.space.raise_element(&window, !locked);
        if let Some(surface) = toplevel_surface(&window) {
            self.set_keyboard_focus(Some(surface), SERIAL_COUNTER.next_serial());
        }
        self.configure_all();
        Ok(())
    }

    /// `focus {stay}`: on a Space that does not show, the window comes back if it was minimized
    /// or hidden and waits in front there; the Space that shows, and the keyboard, stay as they
    /// are. On the Space that shows it is `focus`.
    pub(crate) fn raise_on_its_space(&mut self, id: WindowId) -> Result<(), String> {
        self.window_of(id)?;
        if self.on_current_space(id) {
            return self.focus_window(id);
        }
        self.show_window(id);
        self.windows.rank_front(id);
        Ok(())
    }

    /// Window `id` is gone (its client destroyed it, or an X11 window unmapped).
    pub(crate) fn window_gone(&mut self, id: WindowId) {
        let Some(entry) = self.windows.remove(id) else {
            return;
        };
        let was_focused = self.is_focused(&entry.window);
        self.space.unmap_elem(&entry.window);
        if was_focused {
            self.focus_topmost();
        }
        self.foreign_closed(entry.id);
        crate::handlers::toplevel_meta::forget_icon_file(entry.icon.path.clone());
        if entry.announced {
            self.ipc.emit(Event::WindowClosed { id: entry.id });
        }
    }

    pub(crate) fn close_window(&mut self, id: WindowId) -> Result<(), String> {
        let window = self.window_of(id)?;
        if let Some(toplevel) = window.toplevel() {
            toplevel.send_close();
        } else if let Some(x11) = window.x11_surface() {
            x11.close()
                .map_err(|error| format!("closing an X11 window: {error}"))?;
        }
        Ok(())
    }

    pub(crate) fn is_focused(&self, window: &Window) -> bool {
        let surface = toplevel_surface(window);
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| Some(&focus) == surface.as_ref())
    }

    /// The keyboard to the topmost window still on screen, or to nothing;
    /// while locked, to the lock screen (session/lock.rs).
    pub(crate) fn focus_topmost(&mut self) {
        let topmost = self.space.elements().last().and_then(toplevel_surface);
        self.set_keyboard_focus(topmost, SERIAL_COUNTER.next_serial());
        self.configure_all();
    }

    /// Activation changed: tell every client.
    pub(crate) fn configure_all(&self) {
        for window in self.space.elements() {
            if let Some(toplevel) = window.toplevel() {
                toplevel.send_pending_configure();
            } else if let Some(x11) = window.x11_surface()
                && !x11.is_override_redirect()
            {
                let _ = x11.set_activated(self.is_focused(window));
            }
        }
    }
}

/// An X11 window is told where it is on screen (X apps place their menus by it).
pub(crate) fn x11_follow(window: &Window, at: Point<i32, Logical>) {
    if let Some(x11) = window.x11_surface()
        && !x11.is_override_redirect()
        && x11.geometry().loc != at
    {
        let _ = x11.configure(Rectangle::new(at, x11.geometry().size));
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
