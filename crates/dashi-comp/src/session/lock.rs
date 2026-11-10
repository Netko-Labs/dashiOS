//! The session lock (ext-session-lock): the shell's lock screen, and the
//! compositor's guarantee behind it. While locked, only lock surfaces are
//! drawn and pressed and no shell binding fires; if the lock screen dies
//! without unlocking, the session stays locked (on the wallpaper) until a new
//! one comes, which the shell starts (packages/shell/src/lock/). Only the
//! shell may lock.
//!
//! The keyboard is the lock screen's: every change of keyboard focus goes
//! through `set_keyboard_focus`, which while locked gives it to a lock surface
//! whatever was asked (a window the shell focuses, a new window, a sheet that
//! takes the keyboard, the window under a closed one), and every key is
//! checked against it again before it goes out (keys/locked.rs). An input
//! method's keyboard grab is let go, so no other client hears the keys. On
//! unlock the keyboard goes back to a shell sheet that takes it, else to the
//! window in front.

use crate::ipc::protocol::Event;
use std::collections::HashMap;

use smithay::{
    delegate_session_lock,
    desktop::layer_map_for_output,
    input::pointer::MotionEvent,
    output::Output,
    reexports::wayland_server::protocol::{wl_output::WlOutput, wl_surface::WlSurface},
    utils::{SERIAL_COUNTER, Serial},
    wayland::{
        session_lock::{LockSurface, SessionLockHandler, SessionLockManagerState, SessionLocker},
        shell::wlr_layer::{KeyboardInteractivity, Layer},
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
        // Nothing of the session keeps the keyboard (a lock screen of an
        // earlier lock client that is still up gets it), and no input method holds it.
        self.set_keyboard_focus(None, SERIAL_COUNTER.next_serial());
        self.drop_input_method_grab();
        self.point_at_lock();
        self.overview = None;
        self.ipc.emit(Event::Overview { active: false });
        self.ipc.emit(Event::Lock { locked: true });
    }

    fn unlock(&mut self) {
        self.lock.locked = false;
        self.lock.surfaces.clear();
        self.ipc.emit(Event::Lock { locked: false });
        self.focus_after_unlock();
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
            .is_some_and(|focus| self.is_lock_surface(&focus));
        if under_pointer || !focused_lock {
            self.set_keyboard_focus(Some(wl_surface), SERIAL_COUNTER.next_serial());
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

    /// Whether `surface` is a live lock screen surface (while locked).
    pub(crate) fn is_lock_surface(&self, surface: &WlSurface) -> bool {
        self.lock.locked
            && self
                .lock
                .surfaces
                .values()
                .any(|lock| lock.alive() && lock.wl_surface() == surface)
    }

    /// Where the keyboard belongs while locked: the lock surface on the
    /// pointer's screen, else any live one; none before the lock screen comes.
    fn lock_keyboard_target(&self) -> Option<WlSurface> {
        let under_pointer = self
            .output_under_pointer()
            .and_then(|output| self.lock_surface_on(&output).cloned())
            .filter(LockSurface::alive);
        under_pointer
            .or_else(|| self.lock.surfaces.values().find(|s| s.alive()).cloned())
            .map(|lock| lock.wl_surface().clone())
    }

    /// The keyboard to `focus`. While locked only a lock surface may have it:
    /// anything else asked for is refused, and the keyboard goes back to the
    /// lock screen (or to nothing until its surface comes).
    pub(crate) fn set_keyboard_focus(&mut self, focus: Option<WlSurface>, serial: Serial) {
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        let focus = match focus {
            Some(surface) if !self.lock.locked || self.is_lock_surface(&surface) => Some(surface),
            asked if !self.lock.locked => asked,
            refused => {
                if let Some(surface) = &refused {
                    tracing::debug!(?surface, "locked: the keyboard stays on the lock screen");
                }
                self.lock_keyboard_target()
            }
        };
        if keyboard.current_focus() != focus {
            keyboard.set_focus(self, focus, serial);
        }
    }

    /// While locked: the keyboard back on the lock screen if anything moved it
    /// (or its surface went), and no input method holding it. Every key sent
    /// while locked comes through here first.
    pub(crate) fn keep_keyboard_on_lock(&mut self) {
        if !self.lock.locked {
            return;
        }
        let on_lock = self
            .seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .is_some_and(|focus| self.is_lock_surface(&focus));
        if !on_lock {
            self.set_keyboard_focus(None, SERIAL_COUNTER.next_serial());
        }
        self.drop_input_method_grab();
    }

    /// An input method's keyboard grab (zwp_input_method_v2, the only keyboard
    /// grab dashi-comp has) is let go: while locked it would hear every key.
    /// The input method grabs again when a field activates it after the unlock.
    fn drop_input_method_grab(&mut self) {
        if let Some(keyboard) = self.seat.get_keyboard()
            && keyboard.is_grabbed()
        {
            keyboard.unset_grab(self);
        }
    }

    /// The pointer leaves what it was over (a move grab ends with it), so
    /// nothing of the session hears a scroll or a click before it moves.
    fn point_at_lock(&mut self) {
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        let time = self.start_time.elapsed().as_millis() as u32;
        if pointer.is_grabbed() {
            pointer.unset_grab(self, SERIAL_COUNTER.next_serial(), time);
        }
        let location = pointer.current_location();
        let under = self.surface_under(location);
        let event = MotionEvent {
            location,
            serial: SERIAL_COUNTER.next_serial(),
            time,
        };
        pointer.motion(self, under, &event);
        pointer.frame(self);
    }

    /// After the unlock: a shell sheet that takes the keyboard (one that came
    /// up while locked: a Wi-Fi password, a pairing code) has it, else the
    /// window in front.
    fn focus_after_unlock(&mut self) {
        let sheet = self.space.outputs().find_map(|output| {
            let layers = layer_map_for_output(output);
            [Layer::Overlay, Layer::Top].into_iter().find_map(|layer| {
                layers
                    .layers_on(layer)
                    .rev()
                    .find(|surface| {
                        surface.cached_state().keyboard_interactivity
                            == KeyboardInteractivity::Exclusive
                    })
                    .map(|surface| surface.wl_surface().clone())
            })
        });
        match sheet {
            Some(sheet) => {
                self.set_keyboard_focus(Some(sheet), SERIAL_COUNTER.next_serial());
                self.configure_all();
            }
            None => self.focus_topmost(),
        }
    }
}
