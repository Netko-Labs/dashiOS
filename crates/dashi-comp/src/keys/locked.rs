//! A key pressed while the screen is locked. It goes to the lock screen and
//! nowhere else: by then the keyboard has been put back on a lock surface if
//! anything moved it (session/lock.rs), and no input method holds it. Only the
//! keymap's `locked` rules apply (keymap.rs): ❖ never reaches a client, so the
//! shell's rules there turn the lock screen's ❖ chords into the Ctrl chords
//! its field knows (❖A selects all), and swallow the rest. No binding fires,
//! no snippet is watched, and the overview takes nothing.

use smithay::{
    backend::input::KeyState,
    input::keyboard::{KeyboardHandle, Keycode},
    utils::Serial,
};

use super::{
    handler::KeyInfo,
    keymap::{Mods, Pressed},
};
use crate::state::Dashi;

impl Dashi {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn on_locked_key(
        &mut self,
        keyboard: &KeyboardHandle<Dashi>,
        keycode: Keycode,
        info: &KeyInfo,
        mods: Mods,
        serial: Serial,
        time: u32,
        mods_changed: bool,
    ) {
        let action = self
            .keys
            .keymap
            .action_while_locked(&Pressed {
                names: &info.names,
                mods,
                app_id: "",
            })
            .cloned();
        match action {
            None => {
                keyboard.input_forward(self, keycode, KeyState::Pressed, serial, time, mods_changed)
            }
            Some(action) => self.replay_action(keycode, &action, mods.shift, time),
        }
    }
}
