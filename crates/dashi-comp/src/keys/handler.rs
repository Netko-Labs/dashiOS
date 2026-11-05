//! Every key press goes through here before any client sees it.
//!
//! ❖ (Super) is Dashi's: no client ever sees it; its tap, hold, chord, and
//! release go to the shell as `super` events. Every other key is matched
//! against the shell's keymap, on the compositor's own thread so typing never
//! waits on Bun: a `bind` goes to the shell as a `binding` event, a `send` is
//! replayed to the focused client as another chord while the key is held, a
//! `tap` replays chords at once, a `swallow` is dropped. Keys no rule matches
//! go to the client as they are.

use std::{collections::HashMap, time::Instant};

use serde_json::json;
use smithay::{
    backend::input::KeyState,
    input::keyboard::{Keycode, KeysymHandle, ModifiersState, keysyms, xkb},
    reexports::calloop::timer::{TimeoutAction, Timer},
    utils::SERIAL_COUNTER,
};

use super::keymap::{Action, Chord, KeyRef, Keymap, Mods, Pressed};
use crate::{state::Dashi, wm::window_id_for_surface};

/// The xkb keycodes of the Super keys (evdev KEY_LEFTMETA/KEY_RIGHTMETA + 8).
const SUPER_KEYCODES: [u32; 2] = [133, 134];

#[derive(Default)]
pub(crate) struct Keys {
    pub keymap: Keymap,
    /// The xkb layout and key repeat (layout.rs).
    pub layout: super::layout::KeyboardLayout,
    super_down: Option<SuperPress>,
    /// Bumped on every ❖ press, so a hold timer knows whether its press is still the one held.
    super_generation: u64,
    /// Presses the compositor took, and what their release does.
    taken: HashMap<Keycode, Taken>,
}

struct SuperPress {
    since: Instant,
    chorded: bool,
}

enum Taken {
    Swallowed,
    /// Replayed as another chord, held until this key is released (replay.rs).
    Translated(super::replay::Held),
}

/// What a key is, read from xkb as it is pressed.
struct KeyInfo {
    /// Unshifted keysym names first, then the keysym as typed.
    names: Vec<String>,
    mods: ModifiersState,
    is_modifier: bool,
    function_key: Option<u32>,
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

        if state == KeyState::Released {
            let (_, mods_changed) =
                keyboard.input_intercept::<(), _>(self, keycode, state, |_, _, _| ());
            match self.keys.taken.remove(&keycode) {
                None => keyboard.input_forward(self, keycode, state, serial, time, mods_changed),
                Some(Taken::Swallowed) => {}
                Some(Taken::Translated(held)) => self.replay_release(held, time),
            }
            return;
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

        // Locked: keys go to the lock screen, and nothing else hears them.
        if self.lock.locked {
            return keyboard.input_forward(self, keycode, state, serial, time, mods_changed);
        }
        // A remote desktop or VM with the keyboard gets the keys the keymap would take.
        if self.shortcuts_inhibited() {
            return keyboard.input_forward(self, keycode, state, serial, time, mods_changed);
        }
        let app_id = self.focused_app_id();
        let action = self
            .keys
            .keymap
            .action_for(&Pressed {
                names: &info.names,
                mods,
                app_id: &app_id,
            })
            .cloned();
        // The overview keeps keys from the windows; a shell surface given the keyboard there (its Desktops row) gets them.
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
            None => keyboard.input_forward(self, keycode, state, serial, time, mods_changed),
            Some(Action::Swallow) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
            }
            Some(Action::Bind(name)) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
                let window = self.focused_window_id();
                let key = info.names.first().cloned().unwrap_or_default();
                self.ipc.emit(
                    "binding",
                    json!({ "name": name, "window": window, "key": key, "shift": mods.shift, "ctrl": mods.ctrl, "alt": mods.alt }),
                );
            }
            Some(Action::Send(chord)) => match self.resolve(&chord, keycode, info.mods.shift) {
                Some((target, target_mods)) => {
                    let taken = match self.replay_press(target, target_mods, time) {
                        Some(held) => Taken::Translated(held),
                        None => Taken::Swallowed,
                    };
                    self.keys.taken.insert(keycode, taken);
                }
                None => {
                    self.keys.taken.insert(keycode, Taken::Swallowed);
                }
            },
            Some(Action::Tap(chords)) => {
                self.keys.taken.insert(keycode, Taken::Swallowed);
                for chord in &chords {
                    self.tap(chord, Some(keycode), false, time);
                }
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

    /// The keycode and modifiers that type `chord` in the current layout.
    fn resolve(
        &mut self,
        chord: &Chord,
        pressed: Keycode,
        shift_held: bool,
    ) -> Option<(Keycode, ModifiersState)> {
        let keyboard = self.seat.get_keyboard()?;
        let (target, needs_shift) = match &chord.key {
            KeyRef::Pressed => (pressed, false),
            KeyRef::Named(name) => keyboard.with_xkb_state(self, |context| {
                let xkb = context.xkb().lock().ok()?;
                // SAFETY: the keymap and state are only read while the Xkb lock is held.
                let (keymap, state) = unsafe { (xkb.keymap(), xkb.state()) };
                keycode_for(keymap, state, name)
            })?,
        };
        let mut mods = keyboard.modifier_state();
        mods.ctrl = chord.mods.ctrl;
        mods.alt = chord.mods.alt;
        mods.shift = chord.mods.shift || needs_shift || shift_held;
        mods.logo = false;
        Some((target, mods))
    }

    /// The key (and whether it needs Shift) that types keysym `name` in the person's layout.
    pub(crate) fn keycode_named(&mut self, name: &str) -> Option<(Keycode, bool)> {
        let keyboard = self.seat.get_keyboard()?;
        keyboard.with_xkb_state(self, |context| {
            let xkb = context.xkb().lock().ok()?;
            // SAFETY: the keymap and state are only read while the Xkb lock is held.
            let (keymap, state) = unsafe { (xkb.keymap(), xkb.state()) };
            keycode_for(keymap, state, name)
        })
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
            self.ipc.emit("shortcut", json!({ "name": "stop-agents" }));
            return true;
        }
        false
    }

    fn on_super(&mut self, state: KeyState) {
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
                        let still = state.keys.super_generation == generation
                            && state
                                .keys
                                .super_down
                                .as_ref()
                                .is_some_and(|press| !press.chorded);
                        if still {
                            state.ipc.emit("super", json!({ "phase": "hold" }));
                        }
                        TimeoutAction::Drop
                    },
                );
            }
            KeyState::Released => {
                let Some(press) = self.keys.super_down.take() else {
                    return;
                };
                let tapped = !press.chorded
                    && press.since.elapsed().as_millis() < u128::from(self.keys.keymap.tap_ms);
                if tapped {
                    self.ipc.emit("super", json!({ "phase": "tap" }));
                }
                self.ipc.emit("super", json!({ "phase": "up" }));
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
            self.ipc.emit("super", json!({ "phase": "chord" }));
        }
        true
    }

    fn focused_window_id(&self) -> Option<u64> {
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

fn key_info(mods: &ModifiersState, handle: &KeysymHandle<'_>) -> KeyInfo {
    let mut names: Vec<String> = handle
        .raw_syms()
        .iter()
        .map(|sym| xkb::keysym_get_name(*sym))
        .collect();
    let typed = handle.modified_sym();
    let typed_name = xkb::keysym_get_name(typed);
    if !names.contains(&typed_name) {
        names.push(typed_name);
    }
    let raw = handle.raw_syms().first().copied().unwrap_or(typed);
    let is_modifier = raw.is_modifier_key()
        || raw.raw() == keysyms::KEY_Caps_Lock
        || raw.raw() == keysyms::KEY_Num_Lock;
    let function_key = (keysyms::KEY_F1..=keysyms::KEY_F12)
        .contains(&raw.raw())
        .then(|| raw.raw() - keysyms::KEY_F1 + 1)
        .or_else(|| {
            (keysyms::KEY_XF86Switch_VT_1..=keysyms::KEY_XF86Switch_VT_12)
                .contains(&typed.raw())
                .then(|| typed.raw() - keysyms::KEY_XF86Switch_VT_1 + 1)
        });
    KeyInfo {
        names,
        mods: *mods,
        is_modifier,
        function_key,
    }
}

/// The key, and whether it needs Shift, that types keysym `name` in the active layout.
fn keycode_for(keymap: &xkb::Keymap, state: &xkb::State, name: &str) -> Option<(Keycode, bool)> {
    let sym = match xkb::keysym_from_name(name, xkb::KEYSYM_NO_FLAGS) {
        sym if sym.raw() != keysyms::KEY_NoSymbol => sym,
        _ => xkb::keysym_from_name(name, xkb::KEYSYM_CASE_INSENSITIVE),
    };
    if sym.raw() == keysyms::KEY_NoSymbol {
        return None;
    }
    let layout = state.serialize_layout(xkb::STATE_LAYOUT_EFFECTIVE);
    (keymap.min_keycode().raw()..=keymap.max_keycode().raw()).find_map(|raw| {
        let code = Keycode::new(raw);
        (0..keymap.num_levels_for_key(code, layout).min(2))
            .find(|level| {
                keymap
                    .key_get_syms_by_level(code, layout, *level)
                    .contains(&sym)
            })
            .map(|level| (code, level == 1))
    })
}
