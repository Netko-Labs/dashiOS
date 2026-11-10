//! ❖ (Super) itself: its press, tap, hold, and the chords made while it is held.
//! No client ever sees the key; each phase goes to the shell as a `super` event.

use std::time::Instant;

use smithay::{
    backend::input::KeyState,
    reexports::calloop::timer::{TimeoutAction, Timer},
};

use super::handler::Keys;
use crate::{ipc::protocol::SuperPhase, state::Dashi};

/// The xkb keycodes of the Super keys (evdev KEY_LEFTMETA/KEY_RIGHTMETA + 8).
pub(super) const SUPER_KEYCODES: [u32; 2] = [133, 134];

impl Keys {
    /// ❖ is held.
    pub(super) fn super_is_down(&self) -> bool {
        self.super_down.is_some()
    }
}

pub(super) struct SuperPress {
    since: Instant,
    chorded: bool,
}

impl Dashi {
    pub(super) fn on_super(&mut self, state: KeyState) {
        match state {
            KeyState::Pressed => {
                if self.keys.super_down.is_some() {
                    return;
                }
                self.keys.super_generation += 1;
                let generation = self.keys.super_generation;
                self.keys.super_down = Some(SuperPress {
                    since: Instant::now(),
                    chorded: false,
                });
                let hold = std::time::Duration::from_millis(self.keys.keymap.hold_ms);
                let _ = self.loop_handle.insert_source(
                    Timer::from_duration(hold),
                    move |_, _, state| {
                        // While locked a hold shows nothing: no shell binding fires (session/lock.rs).
                        let still = state.keys.super_generation == generation
                            && !state.lock.locked
                            && state
                                .keys
                                .super_down
                                .as_ref()
                                .is_some_and(|press| !press.chorded);
                        if still {
                            state.ipc.emit(SuperPhase::Hold.event());
                        }
                        TimeoutAction::Drop
                    },
                );
            }
            KeyState::Released => {
                let Some(press) = self.keys.super_down.take() else {
                    return;
                };
                // While locked a tap opens nothing and switches no rules.
                let tapped = !press.chorded
                    && !self.lock.locked
                    && press.since.elapsed().as_millis() < u128::from(self.keys.keymap.tap_ms);
                if tapped {
                    // The shell's rules for after a tap hold from now, not from when it hears of the tap.
                    self.keys.keymap.arm_after_tap();
                    self.ipc.emit(SuperPhase::Tap.event());
                }
                self.ipc.emit(SuperPhase::Up.event());
            }
        }
    }

    /// Something else happened while ❖ is held (a key, a click): it is a chord, not a tap.
    /// Returns whether ❖ is held.
    pub(crate) fn note_chord(&mut self) -> bool {
        let Some(press) = self.keys.super_down.as_mut() else {
            return false;
        };
        if !press.chorded {
            press.chorded = true;
            self.ipc.emit(SuperPhase::Chord.event());
        }
        true
    }
}
