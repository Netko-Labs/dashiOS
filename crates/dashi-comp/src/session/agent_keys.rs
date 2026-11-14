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
    input::{
        Seat,
        keyboard::{FilterResult, KeyboardHandle, Keycode, xkb},
    },
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::SERIAL_COUNTER,
    wayland::input_method::InputMethodSeat,
};

use super::agent_input::{KeyMove, KeyStep};
use crate::state::Dashi;

/// The longest text typed in one request.
pub(super) const MAX_TEXT: usize = 4096;

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

impl Dashi {
    /// Type `steps` into `surface` on `seat`: text as its keys, named keys down, up, or both.
    pub(super) fn agent_keys(
        &mut self,
        seat: &Seat<Dashi>,
        surface: WlSurface,
        steps: &[KeyStep],
    ) -> Result<(), String> {
        let Some(keyboard) = seat.get_keyboard() else {
            return Err("the seat has no keyboard".into());
        };
        if keyboard.current_focus().as_ref() != Some(&surface) {
            if seat == &self.seat {
                // The person's seat, borrowed: its keyboard follows the lock's rule (session/lock.rs).
                self.set_keyboard_focus(Some(surface.clone()), SERIAL_COUNTER.next_serial());
            } else {
                keyboard.set_focus(self, Some(surface.clone()), SERIAL_COUNTER.next_serial());
            }
        }
        let time = self.start_time.elapsed().as_millis() as u32;
        // Past the person's input method, while it holds the keyboard (session/agent_keys.rs).
        let route = key_route(seat.input_method().keyboard_grabbed());
        let send = |state: &mut Dashi, code: Keycode, down: bool| {
            state.agent_key(&keyboard, &surface, route, code, down, time);
        };
        for step in steps {
            if let Some(text) = &step.text {
                if text.chars().count() > MAX_TEXT {
                    return Err("too much text at once".into());
                }
                // Every key is found before the first is pressed: text the layout can't type is
                // refused whole, never typed with holes in it.
                let mut keys = Vec::new();
                for (name, ch) in typed_key_names(text).into_iter().zip(typed_chars(text)) {
                    let key = self.keycode_named(&name).ok_or_else(|| {
                        format!("this keyboard's layout can't type {ch:?}; nothing was typed")
                    })?;
                    keys.push(key);
                }
                let shift_code = self.keycode_named("Shift_L").map(|(code, _)| code);
                for (code, shift) in keys {
                    let shift_code = shift_code.filter(|_| shift);
                    if let Some(shift) = shift_code {
                        send(self, shift, true);
                    }
                    send(self, code, true);
                    send(self, code, false);
                    if let Some(shift) = shift_code {
                        send(self, shift, false);
                    }
                }
                continue;
            }
            let name = step
                .name
                .as_deref()
                .ok_or("a key step needs text or a name")?;
            let (code, _) = self
                .keycode_named(name)
                .ok_or_else(|| format!("no key {name:?} on this keyboard"))?;
            match step.state {
                Some(KeyMove::Down) => {
                    send(self, code, true);
                    self.agent.pressed_keys.push((seat.clone(), code));
                }
                Some(KeyMove::Up) => {
                    send(self, code, false);
                    self.agent
                        .pressed_keys
                        .retain(|(held, c)| !(held == seat && *c == code));
                }
                None => {
                    send(self, code, true);
                    send(self, code, false);
                }
            }
        }
        Ok(())
    }
}

/// The characters of `text` that are keys of their own: "\r\n" is one line's end, so one key.
pub(super) fn typed_chars(text: &str) -> impl Iterator<Item = char> {
    let mut after_return = false;
    text.chars().filter(move |ch| {
        let line_feed_of_a_pair = *ch == '\n' && after_return;
        after_return = *ch == '\r';
        !line_feed_of_a_pair
    })
}

/// The keysym name of the key that types each character of `text`. A line's end is Return: xkb
/// names a newline Linefeed, a key no layout has, so `type_text` dropped it.
pub(super) fn typed_key_names(text: &str) -> Vec<String> {
    typed_chars(text)
        .map(|ch| match ch {
            '\n' | '\r' => "Return".to_owned(),
            _ => xkb::keysym_get_name(xkb::utf32_to_keysym(ch as u32)),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newline_is_the_return_key() {
        assert_eq!(typed_key_names("a\nB"), ["a", "Return", "B"]);
        assert_eq!(typed_key_names("\r\n\n\r"), ["Return", "Return", "Return"]);
        assert_eq!(typed_key_names("\t "), ["Tab", "space"]);
    }

    #[test]
    fn an_input_methods_grab_is_passed_by() {
        assert_eq!(key_route(true), KeyRoute::Window);
        assert_eq!(key_route(false), KeyRoute::Seat);
    }
}
