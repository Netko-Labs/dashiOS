//! Keys the shell holds (IPC `held-keys`): a key in the list never reaches a
//! client, is no modifier and opens nothing; the shell hears it go down and
//! come up (`held-key` events) and decides what holding it means (Dashi's
//! talk key, Esc while Dashi speaks). Mechanism only: which keys, and what
//! they do, are the shell's.
//!
//! A key is named by its evdev code (`KEY_RIGHTMETA` is 126), not by a
//! keysym: the key is the same whatever the layout calls it. Only the
//! person's own keys count: an agent's (`agent-input`) never come this way.
//! While the screen is locked no key is taken; one already down still comes
//! up, so the shell is never left with a key it thinks is held.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use smithay::{backend::input::KeyState, input::keyboard::Keycode};

use crate::{
    ipc::protocol::{Event, Int},
    state::Dashi,
};

/// At most this many keys.
const MAX_KEYS: usize = 16;
/// A name is this many characters at most.
const MAX_NAME: usize = 32;
/// xkb keycodes are evdev codes plus this.
const XKB_OFFSET: u32 = 8;

/// `held-keys`: the whole list each time (`[]` holds none).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HeldKeysParams {
    pub keys: Vec<HeldKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HeldKey {
    /// What the `held-key` events call it.
    pub name: String,
    /// The key's evdev code (linux/input-event-codes.h).
    pub code: Int<1, 767>,
    /// Taken only while no modifier is held (Esc, but not ⌃❖Esc).
    pub bare: Option<bool>,
}

struct Held {
    name: String,
    bare: bool,
}

#[derive(Default)]
pub(crate) struct HeldKeys {
    /// By xkb keycode.
    keys: HashMap<u32, Held>,
    /// The keys down now that were taken, and the name each went down as.
    down: HashMap<u32, String>,
}

impl HeldKeys {
    /// The shell's keys, checked: at most 16, each name 1 to 32 of a–z, 0–9 and `-`, no code twice.
    pub(crate) fn set(&mut self, params: &HeldKeysParams) -> Result<(), String> {
        if params.keys.len() > MAX_KEYS {
            return Err(format!("at most {MAX_KEYS} keys"));
        }
        let mut keys = HashMap::with_capacity(params.keys.len());
        for key in &params.keys {
            let named = !key.name.is_empty()
                && key.name.len() <= MAX_NAME
                && key
                    .name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !named {
                return Err(format!(
                    "a key's name is 1 to {MAX_NAME} of a-z, 0-9 and -: {:?}",
                    key.name
                ));
            }
            let held = Held {
                name: key.name.clone(),
                bare: key.bare.unwrap_or(false),
            };
            if keys
                .insert(key.code.to::<u32>() + XKB_OFFSET, held)
                .is_some()
            {
                return Err(format!("key {} is listed twice", key.code.to::<u32>()));
            }
        }
        // A key down now stays taken until it comes up, whatever the new list says.
        self.keys = keys;
        Ok(())
    }

    /// A key went down: the name it is held as, when the shell holds it now.
    fn press(&mut self, keycode: u32, locked: bool, modifier_held: bool) -> Option<Taken> {
        if self.down.contains_key(&keycode) {
            return Some(Taken::Again);
        }
        let held = self.keys.get(&keycode)?;
        if locked || (held.bare && modifier_held) {
            return None;
        }
        self.down.insert(keycode, held.name.clone());
        Some(Taken::Down(held.name.clone()))
    }

    /// A key came up: the name it went down as, if it was taken.
    fn release(&mut self, keycode: u32) -> Option<String> {
        self.down.remove(&keycode)
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Taken {
    Down(String),
    /// Already down (a second press without a release): taken, and nothing said.
    Again,
}

impl Dashi {
    /// Whether the shell holds this key: it was taken, and the shell told.
    pub(super) fn on_held_key(&mut self, keycode: Keycode, state: KeyState) -> bool {
        let raw = keycode.raw();
        match state {
            KeyState::Released => {
                let Some(name) = self.keys.held.release(raw) else {
                    return false;
                };
                self.ipc.emit(Event::HeldKey { name, down: false });
                true
            }
            KeyState::Pressed => {
                let modifier_held = self.keys.super_is_down()
                    || self.seat.get_keyboard().is_some_and(|keyboard| {
                        let mods = keyboard.modifier_state();
                        mods.ctrl || mods.alt || mods.shift || mods.logo
                    });
                match self.keys.held.press(raw, self.lock.locked, modifier_held) {
                    None => false,
                    Some(Taken::Again) => true,
                    Some(Taken::Down(name)) => {
                        // With ❖ held (a Copilot key sends ⇧❖F23) this is no tap of ❖.
                        self.note_chord();
                        self.keys.snippets.reset();
                        self.ipc.emit(Event::HeldKey { name, down: true });
                        true
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str, code: i64, bare: bool) -> HeldKey {
        HeldKey {
            name: name.into(),
            code: Int::new(code).expect("a key code"),
            bare: bare.then_some(true),
        }
    }

    fn held(keys: Vec<HeldKey>) -> HeldKeys {
        let mut held = HeldKeys::default();
        held.set(&HeldKeysParams { keys })
            .expect("the keys are fine");
        held
    }

    #[test]
    fn a_listed_key_is_taken_down_and_up_by_its_evdev_code() {
        let mut keys = held(vec![key("talk", 126, false), key("talk", 193, false)]);
        // KEY_RIGHTMETA is 126: xkb's 134.
        assert_eq!(
            keys.press(134, false, false),
            Some(Taken::Down("talk".into()))
        );
        assert_eq!(keys.press(134, false, false), Some(Taken::Again));
        assert_eq!(keys.release(134), Some("talk".into()));
        assert_eq!(keys.release(134), None);
        // A Copilot key's F23 comes with ⇧ and ❖ held: still taken.
        assert_eq!(
            keys.press(201, false, true),
            Some(Taken::Down("talk".into()))
        );
        assert_eq!(keys.press(38, false, false), None);
    }

    #[test]
    fn a_bare_key_gives_way_to_a_chord() {
        let mut keys = held(vec![key("stop", 1, true)]);
        assert_eq!(keys.press(9, false, true), None);
        assert_eq!(keys.release(9), None);
        assert_eq!(
            keys.press(9, false, false),
            Some(Taken::Down("stop".into()))
        );
    }

    #[test]
    fn nothing_is_taken_while_locked_but_a_key_down_still_comes_up() {
        let mut keys = held(vec![key("talk", 126, false)]);
        assert_eq!(keys.press(134, true, false), None);
        assert_eq!(
            keys.press(134, false, false),
            Some(Taken::Down("talk".into()))
        );
        // The list changes (and the screen locks) while it is down: its release is still the shell's.
        keys.set(&HeldKeysParams { keys: vec![] })
            .expect("an empty list");
        assert_eq!(keys.release(134), Some("talk".into()));
        assert_eq!(keys.press(134, false, false), None);
    }

    #[test]
    fn a_bad_list_is_refused_whole() {
        let mut keys = held(vec![key("talk", 126, false)]);
        let twice = HeldKeysParams {
            keys: vec![key("a", 1, false), key("b", 1, false)],
        };
        assert!(keys.set(&twice).is_err());
        let unnamed = HeldKeysParams {
            keys: vec![key("", 1, false)],
        };
        assert!(keys.set(&unnamed).is_err());
        let shouting = HeldKeysParams {
            keys: vec![key("Talk Key", 1, false)],
        };
        assert!(keys.set(&shouting).is_err());
        let many = HeldKeysParams {
            keys: (1..=17).map(|code| key("k", code, false)).collect(),
        };
        assert!(keys.set(&many).is_err());
        // What was held before a refusal is held still.
        assert_eq!(
            keys.press(134, false, false),
            Some(Taken::Down("talk".into()))
        );
    }
}
