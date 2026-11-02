//! The X input focus follows the keyboard.

use smithay::{reexports::wayland_server::protocol::wl_surface::WlSurface, utils::SERIAL_COUNTER};

use crate::state::Dashi;

impl Dashi {
    /// The keyboard moved: an X11 window gets the X input focus with it
    /// (Xwayland sends keys to the X focus, which only the WM sets).
    pub(crate) fn x11_focus(&mut self, focused: Option<&WlSurface>) {
        use smithay::input::keyboard::KeyboardTarget;
        let x11 = focused
            .and_then(|surface| self.windows.by_surface(surface))
            .and_then(|entry| entry.window.x11_surface().cloned());
        if self.xwayland.focused == x11 {
            return;
        }
        if let Some(previous) = self.xwayland.focused.take() {
            let _ = previous.set_activated(false);
        }
        let Some(x11) = x11 else { return };
        let _ = x11.set_activated(true);
        if let Some(wm) = self.xwayland.wm.as_mut() {
            let _ = wm.raise_window(&x11);
        }
        // X11Surface's own enter sets the X focus (or sends WM_TAKE_FOCUS) and
        // repeats wl_keyboard.enter on its surface, which Xwayland takes as is.
        let seat = self.seat.clone();
        KeyboardTarget::enter(&x11, &seat, self, Vec::new(), SERIAL_COUNTER.next_serial());
        self.xwayland.focused = Some(x11);
    }
}
