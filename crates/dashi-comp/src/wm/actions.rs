//! What the shell does to windows over IPC: focus, close, minimize, hide,
//! frame. The compositor carries them out; whether to is the shell's
//! decision (docs/compositor-ipc.md, "Session and windows"). Which frame a
//! window had before it was tiled or filled is the shell's to remember too.

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
        self.space.raise_element(&window, true);
        if let (Some(keyboard), Some(surface)) =
            (self.seat.get_keyboard(), toplevel_surface(&window))
        {
            keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
        }
        self.configure_all();
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
            self.ipc
                .emit("window-closed", serde_json::json!({ "id": entry.id }));
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
        // Off screen, it is not the active window; telling it now means its
        // return is a change the client hears (configure_all only walks the
        // windows on screen). An app that minimized itself (Chromium,
        // Electron) ignores clicks until a configure says it is back.
        window.set_activated(false);
        if let Some(toplevel) = window.toplevel() {
            toplevel.send_pending_configure();
        }
        // X11 apps read it back (_NET_WM_STATE_HIDDEN) and can stop drawing.
        if shown == Shown::Minimized
            && let Some(x11) = window.x11_surface()
        {
            let _ = x11.set_suspended(true);
        }
        if shown == Shown::Minimized
            && let Some(frame) = frame
        {
            self.fly(id, frame, true);
        }
        if was_focused {
            self.focus_topmost();
        }
        self.emit_window_state(id);
        Ok(())
    }

    /// Tell the shell a window was minimized, hidden, or shown again (`window-state`).
    fn emit_window_state(&mut self, id: WindowId) {
        if let Some(entry) = self.windows.get(id).filter(|entry| entry.announced) {
            let event = serde_json::json!({ "window": id, "state": entry.shown.name() });
            self.ipc.emit("window-state", event);
        }
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
        let space = entry.space;
        self.emit_window_state(id);
        if let Some(x11) = window.x11_surface() {
            let _ = x11.set_suspended(false);
        }
        if space != self.spaces.current {
            // Back, but on a Space that is not shown: it waits there.
            let bar = super::windows::bar_of(self, &window);
            if let Some(entry) = self.windows.get_mut(id) {
                entry.away_at = Some((at.x, at.y + bar).into());
            }
            return;
        }
        self.map_frame_at(&window, at, true);
        // Back: a configure even if nothing else changed, so the client knows.
        if let Some(toplevel) = window.toplevel() {
            toplevel.send_configure();
        }
        if let Some(frame) = frame_of(self, &window) {
            self.fly(id, frame, false);
        }
    }

    /// Move and size its frame; `maximized` tells the client it fills the
    /// screen (the shell's Fill), `tiled` that the shell made it a tile (its
    /// depth, render/depth/). A window held in a move grab is held at its
    /// new frame from there (move_grab.rs).
    pub(crate) fn frame_window(
        &mut self,
        id: WindowId,
        frame: Rectangle<i32, Logical>,
        maximized: bool,
        tiled: bool,
    ) -> Result<(), String> {
        let window = self.window_of(id)?;
        self.apply_frame(&window, frame, maximized);
        if let Some(entry) = self.windows.get_mut(id) {
            entry.tiled = tiled && !maximized;
        }
        if self.held == Some(id) {
            self.held_reframed = true;
        }
        Ok(())
    }

    /// Size and place a window by its outer frame (title bar included).
    fn apply_frame(&mut self, window: &Window, frame: Rectangle<i32, Logical>, maximized: bool) {
        let bar = super::windows::bar_of(self, window);
        if let Some(entry) = self.windows.by_window_mut(window) {
            entry.maximized = maximized;
            entry.tiled = false;
        }
        if let Some(toplevel) = window.toplevel() {
            let unmaximized = toplevel.with_pending_state(|state| {
                let was = state.states.contains(xdg_toplevel::State::Maximized);
                state.size = Some(Size::from((frame.size.w, (frame.size.h - bar).max(1))));
                if maximized {
                    state.states.set(xdg_toplevel::State::Maximized);
                } else {
                    state.states.unset(xdg_toplevel::State::Maximized);
                }
                was && !maximized
            });
            toplevel.send_pending_configure();
            if unmaximized {
                // The configure that ends maximized may be answered with the
                // size the app had before it was maximized, whatever its size
                // says (GPUI does: it keeps its own "windowed" bounds); a size
                // is only a suggestion outside maximized and full screen. A
                // second configure, no longer a change of state, gives it
                // this size.
                toplevel.send_configure();
            }
        } else if let Some(x11) = window.x11_surface() {
            let size = Size::from((frame.size.w, (frame.size.h - bar).max(1)));
            let _ = x11.set_maximized(maximized);
            let _ = x11.configure(Rectangle::new(x11.geometry().loc, size));
        }
        // Off screen (minimized, hidden, on a Space that is not shown), it takes the frame where it waits.
        if let Some(id) = self.windows.by_window(window).map(|entry| entry.id)
            && self.waits_off_screen(id)
        {
            self.wait_at(id, frame.loc);
            return;
        }
        let activate = self.is_focused(window);
        self.map_frame_at(window, frame.loc, activate);
    }

    /// Placed, but not on screen: minimized, hidden, or on a Space that is not shown.
    pub(crate) fn waits_off_screen(&self, id: WindowId) -> bool {
        self.windows.get(id).is_some_and(|entry| {
            entry.placed && (entry.shown != Shown::Normal || entry.space != self.spaces.current)
        })
    }

    /// Where a window off screen comes back: its outer frame at `at` (global logical).
    pub(crate) fn wait_at(&mut self, id: WindowId, at: Point<i32, Logical>) {
        let Some(window) = self.windows.get(id).map(|entry| entry.window.clone()) else {
            return;
        };
        let bar = super::windows::bar_of(self, &window);
        if let Some(entry) = self.windows.get_mut(id) {
            if entry.shown == Shown::Normal {
                entry.away_at = Some((at.x, at.y + bar).into());
            } else {
                entry.parked_at = Some(at);
            }
        }
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
