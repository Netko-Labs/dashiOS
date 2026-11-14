//! Keys the shell holds (IPC `held-keys`): a key in the list never reaches a
//! client, is no modifier and opens nothing; the shell hears it go down and
//! come up (`held-key` events) and decides what holding it means (Dashi's
//! talk key, Esc while Dashi speaks). Mechanism only: which keys, and what
//! they do, are the shell's.
//!
//! Two kinds are heard without being a key of their own:
//! - `alone`: a modifier held with nothing else (the right ⌥ for dictation).
//!   It still reaches the app as the modifier it is; the shell hears it go
//!   down, and `chord: true` the moment another key goes down under it (it
//!   was a modifier after all).
//! - `super`: a key pressed while ❖ alone is held (❖Space). It is taken, and
//!   comes up for the shell when it or ❖ does, whichever is first.
//!
//! With `tapMs` the compositor says whether the press was a tap (`tap`), and
//! a tap switches to the keymap's `afterTap` rules at once, as a tap of ❖
//! does: what is typed next is the launcher's.
//!
//! A key is named by its evdev code (`KEY_RIGHTMETA` is 126), not by a
//! keysym: the key is the same whatever the layout calls it. Only the
//! person's own keys count: an agent's (`agent-input`) never come this way.
//! While the screen is locked no key is taken; one already down still comes
//! up, so the shell is never left with a key it thinks is held.

use std::{collections::HashMap, time::Instant};

use serde::{Deserialize, Serialize};
use smithay::{backend::input::KeyState, input::keyboard::Keycode};

use super::super_key::SUPER_KEYCODES;
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HeldKey {
    /// What the `held-key` events call it.
    pub name: String,
    /// The key's evdev code (linux/input-event-codes.h).
    pub code: Int<1, 767>,
    /// Taken only while no modifier is held (Esc, but not ⌃❖Esc).
    pub bare: Option<bool>,
    /// Heard, not taken: it reaches the app as the modifier it is, only while no other modifier is held.
    pub alone: Option<bool>,
    /// Taken only while ❖ is held with no other modifier (❖Space).
    #[serde(rename = "super")]
    pub with_super: Option<bool>,
    /// Up within this many ms with no other key is a tap: the event says so, and `afterTap` is armed.
    pub tap_ms: Option<Int<1, 2000>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// The shell's alone: no client sees it.
    Taken,
    Bare,
    Alone,
    WithSuper,
}

struct Held {
    name: String,
    kind: Kind,
    tap_ms: Option<u64>,
}

struct Down {
    name: String,
    kind: Kind,
    since: Instant,
    tap_ms: Option<u64>,
    /// The shell was already told it came up (a chord, ❖ let go first).
    told: bool,
}

/// The modifiers held as a key goes down.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct ModsDown {
    pub logo: bool,
    /// Ctrl, Alt or Shift.
    pub other: bool,
}

/// A key came up, as the shell is told it.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Up {
    pub name: String,
    pub chord: bool,
    pub tap: Option<bool>,
}

#[derive(Default)]
pub(crate) struct HeldKeys {
    /// By xkb keycode.
    keys: HashMap<u32, Held>,
    /// The keys down now that were taken or heard.
    down: HashMap<u32, Down>,
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
            let flags = [key.bare, key.alone, key.with_super].map(|flag| flag.unwrap_or(false));
            let kind = match flags {
                [false, false, false] => Kind::Taken,
                [true, false, false] => Kind::Bare,
                [false, true, false] => Kind::Alone,
                [false, false, true] => Kind::WithSuper,
                _ => {
                    return Err(format!(
                        "key {:?} is one of bare, alone and super",
                        key.name
                    ));
                }
            };
            let held = Held {
                name: key.name.clone(),
                kind,
                tap_ms: key.tap_ms.map(|ms| ms.to::<u64>()),
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

    /// A key went down: the name it is held as, when the shell holds or hears it now.
    fn press(&mut self, keycode: u32, locked: bool, mods: ModsDown, now: Instant) -> Option<Taken> {
        if let Some(down) = self.down.get(&keycode) {
            return Some(Taken::Again(down.kind != Kind::Alone));
        }
        let held = self.keys.get(&keycode)?;
        let wanted = match held.kind {
            Kind::Taken => true,
            Kind::Bare | Kind::Alone => !mods.logo && !mods.other,
            Kind::WithSuper => mods.logo && !mods.other,
        };
        if locked || !wanted {
            return None;
        }
        let down = Down {
            name: held.name.clone(),
            kind: held.kind,
            since: now,
            tap_ms: held.tap_ms,
            told: false,
        };
        self.down.insert(keycode, down);
        Some(Taken::Down(held.name.clone(), held.kind != Kind::Alone))
    }

    /// A key came up: what the shell is told (nothing when it already was), and whether the key was taken.
    fn release(&mut self, keycode: u32, now: Instant) -> Option<(Option<Up>, bool)> {
        let down = self.down.remove(&keycode)?;
        let taken = down.kind != Kind::Alone;
        Some(((!down.told).then(|| up_of(&down, false, now)), taken))
    }

    /// Another key went down: the keys heard as held alone or with ❖ were modifiers after all.
    fn chorded(&mut self, now: Instant) -> Vec<Up> {
        self.end(
            |kind| matches!(kind, Kind::Alone | Kind::WithSuper),
            true,
            now,
        )
    }

    /// ❖ came up: the keys held with it come up for the shell now.
    fn super_up(&mut self, now: Instant) -> Vec<Up> {
        self.end(|kind| kind == Kind::WithSuper, false, now)
    }

    fn end(&mut self, which: impl Fn(Kind) -> bool, chord: bool, now: Instant) -> Vec<Up> {
        let mut ups = Vec::new();
        for down in self.down.values_mut() {
            if !down.told && which(down.kind) {
                down.told = true;
                ups.push(up_of(down, chord, now));
            }
        }
        ups
    }
}

fn up_of(down: &Down, chord: bool, now: Instant) -> Up {
    let tap = down
        .tap_ms
        .map(|ms| !chord && now.saturating_duration_since(down.since).as_millis() < u128::from(ms));
    Up {
        name: down.name.clone(),
        chord,
        tap,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Taken {
    /// It went down as this name; whether it is kept from the client.
    Down(String, bool),
    /// Already down (a second press without a release): nothing said; whether it is kept from the client.
    Again(bool),
}

impl Dashi {
    /// Whether the shell holds this key: it was taken, and the shell told.
    /// A key only heard (`alone`) is told and goes on to the client.
    pub(super) fn on_held_key(&mut self, keycode: Keycode, state: KeyState) -> bool {
        let raw = keycode.raw();
        let now = Instant::now();
        match state {
            KeyState::Released => {
                let Some((up, taken)) = self.keys.held.release(raw, now) else {
                    if SUPER_KEYCODES.contains(&raw) {
                        let ups = self.keys.held.super_up(now);
                        self.tell_ups(ups);
                    }
                    return false;
                };
                self.tell_ups(up.into_iter().collect());
                taken
            }
            KeyState::Pressed => {
                let mods = ModsDown {
                    logo: self.keys.super_is_down(),
                    other: self.seat.get_keyboard().is_some_and(|keyboard| {
                        let mods = keyboard.modifier_state();
                        mods.ctrl || mods.alt || mods.shift || mods.logo
                    }),
                };
                match self.keys.held.press(raw, self.lock.locked, mods, now) {
                    None => {
                        // Another key under a key heard as held: it was a modifier after all.
                        let ups = self.keys.held.chorded(now);
                        self.tell_ups(ups);
                        false
                    }
                    Some(Taken::Again(taken)) => taken,
                    Some(Taken::Down(name, taken)) => {
                        if taken {
                            // With ❖ held (a Copilot key sends ⇧❖F23, ❖Space) this is no tap of ❖.
                            self.note_chord();
                            self.keys.snippets.reset();
                        }
                        self.ipc.emit(Event::HeldKey {
                            name,
                            down: true,
                            chord: None,
                            tap: None,
                        });
                        taken
                    }
                }
            }
        }
    }

    fn tell_ups(&mut self, ups: Vec<Up>) {
        for up in ups {
            // As a tap of ❖ does: the keys after this one are the shell's from now (keymap.rs).
            if up.tap == Some(true) && !self.lock.locked {
                self.keys.keymap.arm_after_tap();
            }
            self.ipc.emit(Event::HeldKey {
                name: up.name,
                down: false,
                chord: up.chord.then_some(true),
                tap: up.tap,
            });
        }
    }
}

#[cfg(test)]
mod tests;
