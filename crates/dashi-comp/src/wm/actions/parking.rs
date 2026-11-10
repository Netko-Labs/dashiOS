//! Taking a window off the screen (minimized, hidden) and bringing it back,
//! and where it waits meanwhile.

use smithay::{
    reexports::wayland_protocols::xdg::shell::server::xdg_toplevel,
    utils::{Logical, Point},
};

use crate::{
    ipc::protocol::Event,
    state::Dashi,
    wm::{Shown, WindowId, frame_of},
};

impl Dashi {
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

    /// Tell the app whether anyone can see its window, as the shell says
    /// (`suspend`): xdg_toplevel's `suspended` state (clients of xdg-shell 6
    /// and later; smithay leaves it out for older ones), an X11 app's
    /// `_NET_WM_STATE_HIDDEN`. An app may stop drawing and polling meanwhile.
    pub(crate) fn suspend_window(&mut self, id: WindowId, on: bool) -> Result<(), String> {
        let window = self.window_of(id)?;
        if let Some(toplevel) = window.toplevel() {
            toplevel.with_pending_state(|state| {
                if on {
                    state.states.set(xdg_toplevel::State::Suspended);
                } else {
                    state.states.unset(xdg_toplevel::State::Suspended);
                }
            });
            toplevel.send_pending_configure();
        } else if let Some(x11) = window.x11_surface() {
            x11.set_suspended(on)
                .map_err(|error| format!("suspending an X11 window: {error}"))?;
        }
        Ok(())
    }

    /// Tell the shell a window was minimized, hidden, or shown again (`window-state`).
    pub(super) fn emit_window_state(&mut self, id: WindowId) {
        if let Some(entry) = self.windows.get(id).filter(|entry| entry.announced) {
            self.ipc.emit(Event::state(id, entry.shown.wire()));
        }
    }

    /// Back on screen where it was, if it was parked.
    pub(super) fn show_window(&mut self, id: WindowId) {
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
            // Back, but on a Space that is not shown: it waits there, in front.
            let bar = crate::wm::geometry::bar_of(self, &window);
            if let Some(entry) = self.windows.get_mut(id) {
                entry.away_at = Some((at.x, at.y + bar).into());
            }
            self.windows.rank_front(id);
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
        let bar = crate::wm::geometry::bar_of(self, &window);
        if let Some(entry) = self.windows.get_mut(id) {
            if entry.shown == Shown::Normal {
                entry.away_at = Some((at.x, at.y + bar).into());
            } else {
                entry.parked_at = Some(at);
            }
        }
    }
}
