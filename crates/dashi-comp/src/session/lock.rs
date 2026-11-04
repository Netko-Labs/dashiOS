//! The session lock (ext-session-lock): the shell's lock screen, and the
//! compositor's guarantee behind it. While locked, only lock surfaces are
//! drawn and pressed and no shell binding fires; if the lock screen dies
//! without unlocking, the session stays locked (on the wallpaper) until a new
//! one comes, which the shell starts (packages/shell/src/lock/). Only the
//! shell may lock.

use std::collections::HashMap;

use serde_json::json;
use smithay::{
    delegate_session_lock,
    output::Output,
    reexports::wayland_server::protocol::wl_output::WlOutput,
    utils::SERIAL_COUNTER,
    wayland::session_lock::{
        LockSurface, SessionLockHandler, SessionLockManagerState, SessionLocker,
    },
};

use crate::state::Dashi;

#[derive(Default)]
pub(crate) struct Lock {
    pub locked: bool,
    /// The lock screen's surface on each screen, by output name.
    pub surfaces: HashMap<String, LockSurface>,
}

impl SessionLockHandler for Dashi {
    fn lock_state(&mut self) -> &mut SessionLockManagerState {
        &mut self.session_lock_state
    }

    fn lock(&mut self, confirmation: SessionLocker) {
        self.lock.locked = true;
        confirmation.lock();
        if let Some(keyboard) = self.seat.get_keyboard() {
            keyboard.set_focus(self, None, SERIAL_COUNTER.next_serial());
        }
        self.overview = None;
        self.ipc.emit("overview", json!({ "active": false }));
        self.ipc.emit("lock", json!({ "locked": true }));
    }

    fn unlock(&mut self) {
        self.lock.locked = false;
        self.lock.surfaces.clear();
        self.ipc.emit("lock", json!({ "locked": false }));
        self.focus_topmost();
    }

    fn new_surface(&mut self, surface: LockSurface, output: WlOutput) {
        let Some(output) = Output::from_resource(&output) else {
            return;
        };
        let Some(screen) = self.space.output_geometry(&output) else {
            return;
        };
        surface.with_pending_state(|state| {
            state.size = Some((screen.size.w.max(1) as u32, screen.size.h.max(1) as u32).into());
        });
        surface.send_configure();
        let wl_surface = surface.wl_surface().clone();
        self.lock.surfaces.insert(output.name(), surface);
        // The keyboard to the lock screen, on the screen with the pointer first.
        let under_pointer = self.output_under_pointer().is_some_and(|o| o == output);
        let focused_lock = self
            .seat
            .get_keyboard()
            .and_then(|k| k.current_focus())
            .is_some_and(|focus| {
                self.lock
                    .surfaces
                    .values()
                    .any(|s| s.wl_surface() == &focus)
            });
        if (under_pointer || !focused_lock)
            && let Some(keyboard) = self.seat.get_keyboard()
        {
            keyboard.set_focus(self, Some(wl_surface), SERIAL_COUNTER.next_serial());
        }
    }
}

delegate_session_lock!(Dashi);

impl Dashi {
    /// The lock screen's surface on `output`, while locked.
    pub(crate) fn lock_surface_on(&self, output: &Output) -> Option<&LockSurface> {
        self.lock
            .locked
            .then(|| self.lock.surfaces.get(&output.name()))
            .flatten()
    }
}
