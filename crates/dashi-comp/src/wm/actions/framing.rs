//! Sizing and placing a window by the frame the shell asks for.

use smithay::{
    desktop::Window,
    reexports::wayland_protocols::xdg::shell::server::xdg_toplevel,
    utils::{Logical, Rectangle, Size},
};

use crate::{state::Dashi, wm::WindowId};

impl Dashi {
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
        let bar = crate::wm::geometry::bar_of(self, window);
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
}
