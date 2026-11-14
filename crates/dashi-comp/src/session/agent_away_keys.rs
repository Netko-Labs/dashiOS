//! An agent's keys into a window on a Space that does not show
//! (session/agent_away.rs has the rules): the keyboard enters the window,
//! the keys go with modifiers kept in an xkb state of the agent's own, and it
//! leaves, all in one request. The seat's own keyboard is not touched.

use smithay::{
    backend::input::KeyState,
    input::keyboard::{Keycode, xkb},
    reexports::wayland_server::{
        Client, Resource,
        protocol::{wl_keyboard::WlKeyboard, wl_surface::WlSurface},
    },
    utils::SERIAL_COUNTER,
};

use super::{
    agent_input::{KeyMove, KeyStep},
    agent_keys::{MAX_TEXT, typed_chars, typed_key_names},
};
use crate::state::Dashi;

impl Dashi {
    /// Type `steps` into `surface`, a window off screen: the keyboard enters it, the keys go with
    /// the agent's own modifiers, and it leaves.
    pub(super) fn away_keys(
        &mut self,
        client: &Client,
        surface: &WlSurface,
        steps: &[KeyStep],
    ) -> Result<(), String> {
        let keyboard = self.seat.get_keyboard().ok_or("the seat has no keyboard")?;
        let keys = self.away_key_plan(steps)?;
        // The person's keyboard, in another window of this app, leaves it for the request.
        let theirs = keyboard
            .current_focus()
            .filter(|focus| focus.client().as_ref() == Some(client));
        if theirs.is_some() {
            self.may_step_aside()?;
        }
        let (mut xkb, layout) = keyboard.with_xkb_state(self, |context| {
            let guard = context.xkb().lock().map_err(|_| "the keyboard is busy")?;
            // SAFETY: the keymap is only read, and cloned, while the Xkb lock is held.
            let keymap = unsafe { guard.keymap() }.clone();
            Ok::<_, String>((xkb::State::new(&keymap), guard.active_layout().0))
        })?;
        xkb.update_mask(0, 0, 0, 0, 0, layout);
        let keyboards: Vec<WlKeyboard> = keyboard.client_keyboards(client).collect();
        let time = self.start_time.elapsed().as_millis() as u32;
        let serial = || SERIAL_COUNTER.next_serial().into();
        let mods = |keyboard: &WlKeyboard, xkb: &xkb::State| {
            keyboard.modifiers(
                serial(),
                xkb.serialize_mods(xkb::STATE_MODS_DEPRESSED),
                xkb.serialize_mods(xkb::STATE_MODS_LATCHED),
                xkb.serialize_mods(xkb::STATE_MODS_LOCKED),
                xkb.serialize_layout(xkb::STATE_LAYOUT_EFFECTIVE),
            );
        };
        for each in &keyboards {
            if let Some(theirs) = &theirs {
                each.leave(serial(), theirs);
            }
            each.enter(serial(), surface, Vec::new());
            mods(each, &xkb);
        }
        let mut down: Vec<Keycode> = Vec::new();
        for (code, pressed) in keys {
            if pressed {
                down.push(code);
            } else {
                down.retain(|held| *held != code);
            }
            away_key(&keyboards, &mut xkb, code, pressed, time, &mods);
        }
        // Nothing stays down in a window nobody sees.
        for code in down {
            away_key(&keyboards, &mut xkb, code, false, time, &mods);
        }
        for each in &keyboards {
            each.leave(serial(), surface);
        }
        // Theirs again, with the keys they hold and their own modifiers.
        if let Some(theirs) = &theirs {
            let held: Vec<u8> = keyboard
                .pressed_keys()
                .into_iter()
                .flat_map(|code| (code.raw() - 8).to_ne_bytes())
                .collect();
            let state = keyboard.modifier_state().serialized;
            for each in &keyboards {
                each.enter(serial(), theirs, held.clone());
                each.modifiers(
                    serial(),
                    state.depressed,
                    state.latched,
                    state.locked,
                    state.layout_effective,
                );
            }
        }
        Ok(())
    }

    /// Every key of `steps`, pressed (true) or let go, found before the first is sent: text the
    /// layout cannot type is refused whole.
    fn away_key_plan(&mut self, steps: &[KeyStep]) -> Result<Vec<(Keycode, bool)>, String> {
        let mut plan = Vec::new();
        let shift = self.keycode_named("Shift_L").map(|(code, _)| code);
        for step in steps {
            if let Some(text) = &step.text {
                if text.chars().count() > MAX_TEXT {
                    return Err("too much text at once".into());
                }
                for (name, ch) in typed_key_names(text).into_iter().zip(typed_chars(text)) {
                    let (code, shifted) = self.keycode_named(&name).ok_or_else(|| {
                        format!("this keyboard's layout can't type {ch:?}; nothing was typed")
                    })?;
                    let shift = shift.filter(|_| shifted);
                    plan.extend(shift.map(|shift| (shift, true)));
                    plan.extend([(code, true), (code, false)]);
                    plan.extend(shift.map(|shift| (shift, false)));
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
                Some(KeyMove::Down) => plan.push((code, true)),
                Some(KeyMove::Up) => plan.push((code, false)),
                None => plan.extend([(code, true), (code, false)]),
            }
        }
        Ok(plan)
    }
}

/// One key to `keyboards`, then the modifiers if it changed them (in `xkb`, the agent's own state).
fn away_key(
    keyboards: &[WlKeyboard],
    xkb: &mut xkb::State,
    code: Keycode,
    pressed: bool,
    time: u32,
    mods: &impl Fn(&WlKeyboard, &xkb::State),
) {
    let (state, direction) = if pressed {
        (KeyState::Pressed, xkb::KeyDirection::Down)
    } else {
        (KeyState::Released, xkb::KeyDirection::Up)
    };
    let serial = SERIAL_COUNTER.next_serial().into();
    // wl_keyboard keys are evdev codes, xkb's less 8.
    for keyboard in keyboards {
        keyboard.key(serial, time, code.raw() - 8, state.into());
    }
    let changed = xkb.update_key(code, direction);
    let mod_bits = xkb::STATE_MODS_DEPRESSED | xkb::STATE_MODS_LATCHED | xkb::STATE_MODS_LOCKED;
    if changed & mod_bits != 0 {
        for keyboard in keyboards {
            mods(keyboard, xkb);
        }
    }
}
