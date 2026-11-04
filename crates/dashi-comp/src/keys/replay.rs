//! Replaying a chord to the focused client the way a keyboard types it.
//!
//! smithay sends a key before the modifier state that comes with it
//! (libxkbcommon wants a modifier key's own press first), so a key replayed
//! with new modifiers reached apps without them: ❖C, sent as Ctrl+C, arrived
//! as a plain "c" in every app. The modifiers a chord adds go first, as
//! presses of their left-hand keys, each followed by the new state; then the
//! chord's key. On release the key goes, then the modifier keys, and the state
//! the person's own keys make comes back. Xwayland, which follows keys rather
//! than the modifier state alone, sees a real Ctrl too.

use smithay::{
    backend::input::KeyState,
    input::keyboard::{Keycode, ModifiersState},
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

/// The left-hand modifier keys (evdev KEY_LEFTCTRL, KEY_LEFTSHIFT, KEY_LEFTALT + 8).
const CTRL: u32 = 37;
const SHIFT: u32 = 50;
const ALT: u32 = 64;

/// A replayed key the client holds, and what its release must undo.
pub(super) struct Held {
    target: Keycode,
    /// The modifier state before the replay (the person's own keys).
    restore: ModifiersState,
    /// Modifier keys pressed for the chord, in press order.
    modifiers: Vec<Keycode>,
}

impl Dashi {
    /// Press `target` with `mods` for the focused client.
    pub(super) fn replay_press(
        &mut self,
        target: Keycode,
        mods: ModifiersState,
        time: u32,
    ) -> Option<Held> {
        let keyboard = self.seat.get_keyboard()?;
        let restore = keyboard.modifier_state();
        keyboard.set_modifier_state(mods);
        let modifiers = added(&restore, &mods);
        for key in &modifiers {
            keyboard.input_forward(
                self,
                *key,
                KeyState::Pressed,
                SERIAL_COUNTER.next_serial(),
                time,
                true,
            );
        }
        // With no modifier key pressed, the state can only have lost one (a
        // held Shift dropped): it follows the key, as smithay orders them.
        keyboard.input_forward(
            self,
            target,
            KeyState::Pressed,
            SERIAL_COUNTER.next_serial(),
            time,
            modifiers.is_empty(),
        );
        Some(Held {
            target,
            restore,
            modifiers,
        })
    }

    /// Let go of a replayed key, then of the modifier keys pressed for it.
    pub(super) fn replay_release(&mut self, held: Held, time: u32) {
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        if held.modifiers.is_empty() {
            keyboard.set_modifier_state(held.restore);
            keyboard.input_forward(
                self,
                held.target,
                KeyState::Released,
                SERIAL_COUNTER.next_serial(),
                time,
                true,
            );
            return;
        }
        keyboard.input_forward(
            self,
            held.target,
            KeyState::Released,
            SERIAL_COUNTER.next_serial(),
            time,
            false,
        );
        keyboard.set_modifier_state(held.restore);
        for key in held.modifiers.iter().rev() {
            keyboard.input_forward(
                self,
                *key,
                KeyState::Released,
                SERIAL_COUNTER.next_serial(),
                time,
                true,
            );
        }
    }
}

/// The modifier keys to press to go from `from` to `to`: Ctrl, Alt, and
/// Shift that `to` has and `from` doesn't, in that order.
fn added(from: &ModifiersState, to: &ModifiersState) -> Vec<Keycode> {
    [
        (to.ctrl && !from.ctrl, CTRL),
        (to.alt && !from.alt, ALT),
        (to.shift && !from.shift, SHIFT),
    ]
    .into_iter()
    .filter(|(add, _)| *add)
    .map(|(_, key)| Keycode::new(key))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mods(ctrl: bool, alt: bool, shift: bool) -> ModifiersState {
        ModifiersState {
            ctrl,
            alt,
            shift,
            ..Default::default()
        }
    }

    #[test]
    fn presses_the_modifiers_a_chord_adds_and_only_those() {
        // ❖C → Ctrl+C: Ctrl goes down first.
        assert_eq!(
            added(&mods(false, false, false), &mods(true, false, false)),
            vec![Keycode::new(CTRL)]
        );
        // ⇧❖Z → Ctrl+Shift+Z with Shift held: only Ctrl.
        assert_eq!(
            added(&mods(false, false, true), &mods(true, false, true)),
            vec![Keycode::new(CTRL)]
        );
        // ⌥← → Ctrl+←: Ctrl is added, Alt (held) is dropped, nothing pressed for it.
        assert_eq!(
            added(&mods(false, true, false), &mods(true, false, false)),
            vec![Keycode::new(CTRL)]
        );
        assert_eq!(
            added(&mods(false, false, false), &mods(true, true, true)),
            vec![Keycode::new(CTRL), Keycode::new(ALT), Keycode::new(SHIFT)]
        );
        assert!(added(&mods(true, false, false), &mods(true, false, false)).is_empty());
    }
}
