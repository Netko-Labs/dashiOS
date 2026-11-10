//! Every key press goes through here before any client sees it.
//!
//! ❖ (Super) is Dashi's: no client ever sees its key; its tap, hold, chord, and
//! release go to the shell as `super` events (a click with it held lends the
//! clicked window Super, super_click.rs). Every other key is matched
//! against the shell's keymap, on the compositor's own thread so typing never
//! waits on Bun: a `bind` goes to the shell as a `binding` event, a `send` is
//! replayed to the focused client as another chord while the key is held, a
//! `tap` replays chords at once, a `swallow` is dropped. Keys no rule matches
//! go to the client as they are. A `binding` carries the key's text as
//! typed, when it has one, so the shell can take typing too (the launcher's
//! keys between a ❖ tap and its field taking the keyboard), and a tap switches
//! to the keymap's `afterTap` rules at once, before the shell has heard of it
//! (so does a `bind` rule that `armsAfterTap`: ❖Space).

use std::collections::HashMap;

use smithay::{
    backend::input::KeyState,
    input::keyboard::{KeyboardHandle, Keycode},
    utils::{SERIAL_COUNTER, Serial},
};

use super::{
    keymap::{Action, Chord, Keymap, Mods, Pressed},
    keysyms::{KeyInfo, key_info},
    super_key::{SUPER_KEYCODES, SuperPress},
};
use crate::{ipc::protocol::Event, state::Dashi, wm::window_id_for_surface};

#[derive(Default)]
pub(crate) struct Keys {
    pub keymap: Keymap,
    /// The xkb layout and key repeat (layout.rs).
    pub layout: super::layout::KeyboardLayout,
    pub(super) super_down: Option<SuperPress>,
    /// Bumped on every ❖ press, so a hold timer knows whether its press is still the one held.
    pub(super) super_generation: u64,
    /// Presses the compositor took, and what their release does.
    pub(super) taken: HashMap<Keycode, Taken>,
    /// The snippets' keywords, and what was just typed (snippets.rs).
    pub snippets: super::snippets::Snippets,
    /// The button of a ❖-click whose client was lent Super until it comes up (super_click.rs).
    pub(super) lent_super: Option<u32>,
}

pub(super) enum Taken {
    Swallowed,
    /// Replayed as another chord, held until this key is released (replay.rs).
    Translated(super::replay::Held),
}

impl Dashi {
    pub(crate) fn on_key(&mut self, keycode: Keycode, state: KeyState, time: u32) {
        if SUPER_KEYCODES.contains(&keycode.raw()) {
            return self.on_super(state);
        }
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        let serial = SERIAL_COUNTER.next_serial();
        // Locked: whatever moved the keyboard, it is back on the lock screen
        // (or on nothing) before this key goes anywhere (session/lock.rs).
        self.keep_keyboard_on_lock();

        if state == KeyState::Released {
            return self.on_key_released(&keyboard, keycode, serial, time);
        }

        let (info, mods_changed) =
            keyboard.input_intercept(self, keycode, state, |_, mods, handle| {
                key_info(mods, &handle)
            });
        if info.is_modifier {
            return keyboard.input_forward(self, keycode, state, serial, time, mods_changed);
        }
        let super_held = self.note_chord();
        let mods = Mods {
            super_: super_held,
            ctrl: info.mods.ctrl,
            alt: info.mods.alt,
            shift: info.mods.shift,
        };

        if self.built_in(&info, mods) {
            self.keys.taken.insert(keycode, Taken::Swallowed);
            return;
        }

        // Locked: keys go to the lock screen, and nothing else hears them (locked.rs).
        if self.lock.locked {
            return self.on_locked_key(&keyboard, keycode, &info, mods, serial, time, mods_changed);
        }
        // A remote desktop or VM with the keyboard gets the keys the keymap would take.
        if self.shortcuts_inhibited() {
            return keyboard.input_forward(self, keycode, state, serial, time, mods_changed);
        }
        let app_id = self.focused_app_id();
        let (action, arms_after_tap) = self
            .keys
            .keymap
            .matched(&Pressed {
                names: &info.names,
                mods,
                app_id: &app_id,
            })
            .map_or((None, false), |(action, arms)| (Some(action.clone()), arms));
        // The overview keeps keys from the windows; a shell surface given the keyboard there (its Desktops row) gets them.
        if action.is_some() {
            self.keys.snippets.reset();
        }
        if self.overview_open()
            && !self.keyboard_on_layer()
            && !matches!(action, Some(Action::Bind(_)))
        {
            self.keys.taken.insert(keycode, Taken::Swallowed);
            let key = info.names.last().cloned().unwrap_or_default();
            self.overview_key(&key);
            return;
        }
        match action {
            None => {
                keyboard.input_forward(self, keycode, state, serial, time, mods_changed);
                self.watch_snippets(&info, mods);
            }
            Some(Action::Bind(name)) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
                self.emit_binding(name, &info, mods, arms_after_tap);
            }
            Some(action) => self.replay_action(keycode, &action, info.mods.shift, time),
        }
    }

    /// A key came up: to the client, if the press went there; else what its press left held.
    fn on_key_released(
        &mut self,
        keyboard: &KeyboardHandle<Dashi>,
        keycode: Keycode,
        serial: Serial,
        time: u32,
    ) {
        let state = KeyState::Released;
        let (_, mods_changed) =
            keyboard.input_intercept::<(), _>(self, keycode, state, |_, _, _| ());
        match self.keys.taken.remove(&keycode) {
            None => keyboard.input_forward(self, keycode, state, serial, time, mods_changed),
            Some(Taken::Swallowed) => {}
            Some(Taken::Translated(held)) => self.replay_release(held, time),
        }
    }

    /// A `bind` rule matched: the shell hears the binding, with the key and its text.
    fn emit_binding(&mut self, name: String, info: &KeyInfo, mods: Mods, arms_after_tap: bool) {
        let window = self.focused_window_id();
        let key = info.names.first().cloned().unwrap_or_default();
        let held = [mods.shift, mods.ctrl, mods.alt];
        let event = Event::binding(name, window, key, held, info.text.clone());
        self.ipc.emit(event);
        // As a ❖ tap does: the keys after this one are the shell's from now (keymap.rs).
        if arms_after_tap {
            self.keys.keymap.arm_after_tap();
        }
    }

    /// A `send`, `tap`, or `swallow` for the key `keycode`: what the focused
    /// client gets instead of it, if anything. Its release follows (`taken`).
    pub(super) fn replay_action(
        &mut self,
        keycode: Keycode,
        action: &Action,
        shift: bool,
        time: u32,
    ) {
        match action {
            Action::Send(chord) => {
                let taken = self
                    .resolve(chord, keycode, shift)
                    .and_then(|(target, target_mods)| self.replay_press(target, target_mods, time))
                    .map_or(Taken::Swallowed, Taken::Translated);
                self.keys.taken.insert(keycode, taken);
            }
            Action::Tap(chords) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
                for chord in chords {
                    self.tap(chord, Some(keycode), false, time);
                }
            }
            Action::Swallow | Action::Bind(_) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
            }
        }
    }

    /// Press and release `chord` at once for the focused client (`tap`, `send-keys`).
    /// `pressed` stands in for `key` in the chord; `keep_shift` passes a held Shift through.
    pub(crate) fn tap(
        &mut self,
        chord: &Chord,
        pressed: Option<Keycode>,
        keep_shift: bool,
        time: u32,
    ) -> bool {
        let pressed = pressed.unwrap_or(Keycode::new(0));
        let Some((target, mods)) = self.resolve(chord, pressed, keep_shift) else {
            return false;
        };
        if target.raw() == 0 {
            return false;
        }
        let Some(held) = self.replay_press(target, mods, time) else {
            return false;
        };
        self.replay_release(held, time);
        true
    }

    /// Keys the compositor keeps whatever the keymap says.
    fn built_in(&mut self, info: &KeyInfo, mods: Mods) -> bool {
        let name = info.names.first().map(String::as_str).unwrap_or_default();
        if mods.ctrl && mods.alt && !mods.super_ {
            if let Some(vt) = info.function_key {
                self.backend.change_vt(vt);
                return true;
            }
            if name == "BackSpace" && !self.lock.locked {
                tracing::info!("Ctrl+Alt+Backspace: leaving the session");
                self.loop_signal.stop();
                return true;
            }
        }
        if mods.ctrl && mods.super_ && !mods.alt && name == "Escape" {
            let name = "stop-agents".into();
            self.ipc.emit(Event::Shortcut { name });
            return true;
        }
        false
    }

    pub(super) fn focused_window_id(&self) -> Option<u64> {
        let focus = self.seat.get_keyboard()?.current_focus()?;
        window_id_for_surface(self, &focus)
    }

    fn focused_app_id(&self) -> String {
        self.seat
            .get_keyboard()
            .and_then(|keyboard| keyboard.current_focus())
            .and_then(|focus| {
                self.windows
                    .by_surface(&focus)
                    .map(|entry| crate::wm::names(&entry.window).0)
            })
            .unwrap_or_default()
    }
}
