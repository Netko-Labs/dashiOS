//! The held keys in the key handler (keys/handler.rs): each key asks here
//! first, and what the shell is told as one goes down or comes up.

use std::time::Instant;

use smithay::{backend::input::KeyState, input::keyboard::Keycode};

use super::{ModsDown, Taken, Up};
use crate::{ipc::protocol::Event, keys::super_key::SUPER_KEYCODES, state::Dashi};

impl Dashi {
    /// Whether the shell holds this key: it was taken, and the shell told.
    /// A key only heard (`alone`) is told and goes on to the client.
    pub(in crate::keys) fn on_held_key(&mut self, keycode: Keycode, state: KeyState) -> bool {
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
