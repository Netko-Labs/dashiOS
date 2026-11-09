//! Where an agent's key goes (`agent-input` keys, session/agent.rs).
//!
//! While a text field is active, the person's input method (fcitx5,
//! zwp_input_method_v2) holds the keyboard: every key goes to it, and it
//! sends back what it doesn't compose on its virtual keyboard. An agent's
//! keys never take that way. What an agent types is literal text, which an
//! input method would compose (Pinyin turning "ni" into 你), and the method
//! follows fields as they take and lose focus a moment after the keys: a
//! click then `type_text` in Helium lost up to 14 of 50 keys while it caught
//! up (dashi-0.5.0-review/56-helium-typing). So while one holds the keyboard,
//! an agent's key updates the seat's keyboard state as any key does (its
//! modifiers, what is held) and goes straight to the window's client, in
//! order, after the keyboard's enter and modifiers; the person's own keys
//! still go through the input method.

use smithay::{
    backend::input::KeyState,
    input::keyboard::{FilterResult, KeyboardHandle, Keycode},
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

/// How an agent's key reaches the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeyRoute {
    /// Through the seat's keyboard, as the person's keys go when nothing grabs it.
    Seat,
    /// Straight to the focused window's client, past an input method's grab.
    Window,
}

/// The route for an agent's keys on a seat whose keyboard an input method has (or hasn't) grabbed.
pub(crate) fn key_route(input_method_grabs: bool) -> KeyRoute {
    if input_method_grabs {
        KeyRoute::Window
    } else {
        KeyRoute::Seat
    }
}

impl Dashi {
    /// Press or release `code` for an agent, on `keyboard`, whose focus is `surface`.
    pub(crate) fn agent_key(
        &mut self,
        keyboard: &KeyboardHandle<Dashi>,
        surface: &WlSurface,
        route: KeyRoute,
        code: Keycode,
        down: bool,
        time: u32,
    ) {
        let state = if down {
            KeyState::Pressed
        } else {
            KeyState::Released
        };
        let serial = SERIAL_COUNTER.next_serial();
        match route {
            KeyRoute::Seat => {
                keyboard.input::<(), _>(self, code, state, serial, time, |_, _, _| {
                    FilterResult::Forward
                });
            }
            KeyRoute::Window => {
                // The seat's own state first (modifiers, held keys), as for any key, then the key.
                let ((), mods_changed) =
                    keyboard.input_intercept::<(), _>(self, code, state, |_, _, _| ());
                let Some(client) = surface.client() else {
                    return;
                };
                let mods = mods_changed.then(|| keyboard.modifier_state().serialized);
                for kbd in keyboard.client_keyboards(&client) {
                    // wl_keyboard keys are evdev codes, xkb's less 8.
                    kbd.key(serial.into(), time, code.raw() - 8, state.into());
                    // After the key, as libxkbcommon expects (smithay's own order).
                    if let Some(mods) = mods {
                        kbd.modifiers(
                            serial.into(),
                            mods.depressed,
                            mods.latched,
                            mods.locked,
                            mods.layout_effective,
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_input_methods_grab_is_passed_by() {
        assert_eq!(key_route(true), KeyRoute::Window);
        assert_eq!(key_route(false), KeyRoute::Seat);
    }
}
