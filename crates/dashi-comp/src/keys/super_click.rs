//! ❖ with a pointer button: the window with the button hears Super.
//!
//! ❖ is Dashi's (handler.rs): its key never reaches a client, so xkb's state
//! never holds it, and a ❖-click arrived in apps as a plain click (Files'
//! ❖-click, which adds an item to the selection as ⌘-click does on the Mac,
//! selected it alone). While a button is down in the window that has the
//! keyboard, that window hears ❖ as the modifier it is: the person's
//! modifiers with Super (Mod4, xkb's "Super"/logo) added, as one
//! `wl_keyboard.modifiers`, when the button goes down with ❖ held or ❖ goes
//! down with the button held (a drag whose rule ❖ changes midway); and the
//! real state again when ❖ is let go, or after the button's release. A ❖
//! pressed during such a drag is a chord, never a tap: the launcher stays
//! shut. Nothing else changes: with no button down ❖ is Dashi's, and the
//! compositor's own xkb state, and so the keymap's matching, never sees Super.

use smithay::{
    input::keyboard::{KeyboardTarget, ModifiersState, xkb},
    reexports::wayland_server::Resource,
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    /// A button went down on a client: while it is down that window hears ❖, held now or pressed later.
    pub(crate) fn lend_super(&mut self, button: u32) {
        if self.keys.client_button.is_some() || !self.button_is_the_keyboards() {
            return;
        }
        self.keys.client_button = Some(button);
        if self.keys.super_is_down() {
            self.tell_super(true);
        }
    }

    /// A button came up: if its window was lent Super, it hears the modifiers as they are again.
    pub(crate) fn return_super(&mut self, button: u32) {
        if self.keys.client_button != Some(button) {
            return;
        }
        self.keys.client_button = None;
        self.tell_super(false);
    }

    /// ❖ went down or up. True while a button is held down in a window: the
    /// window was told, and the press is no tap.
    pub(super) fn super_in_a_drag(&mut self, down: bool) -> bool {
        if self.keys.client_button.is_none() {
            return false;
        }
        self.tell_super(down);
        true
    }

    /// Whether the surface under the pointer is the keyboard's client's: only
    /// the window taking the click hears Super; a panel that leaves the
    /// keyboard where it was isn't it.
    fn button_is_the_keyboards(&self) -> bool {
        let focus = self.seat.get_keyboard().and_then(|k| k.current_focus());
        let under = self.seat.get_pointer().and_then(|p| p.current_focus());
        matches!((focus, under), (Some(focus), Some(under)) if focus.id().same_client_as(&under.id()))
    }

    /// Tell the window with the keyboard its modifiers: with Super (`held`), or as they are.
    fn tell_super(&mut self, held: bool) {
        if held == self.keys.super_lent {
            return;
        }
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        let Some(focus) = keyboard.current_focus() else {
            self.keys.super_lent = false;
            return;
        };
        let mut mods = keyboard.modifier_state();
        if held {
            if !self.button_is_the_keyboards() {
                return;
            }
            let logo = keyboard.with_xkb_state(self, |context| {
                let xkb = context.xkb().lock().ok()?;
                // SAFETY: the keymap is only read while the Xkb lock is held.
                let keymap = unsafe { xkb.keymap() };
                Some(keymap.mod_get_index(xkb::MOD_NAME_LOGO))
            });
            let Some(lent) = logo.and_then(|index| with_super(mods, index)) else {
                return;
            };
            mods = lent;
        }
        self.keys.super_lent = held;
        let seat = self.seat.clone();
        focus.modifiers(&seat, self, mods, SERIAL_COUNTER.next_serial());
    }
}

/// `mods` with Super held too, Super being xkb modifier `logo` (none in a keymap without it).
fn with_super(mut mods: ModifiersState, logo: xkb::ModIndex) -> Option<ModifiersState> {
    if logo == xkb::MOD_INVALID || logo >= u32::BITS {
        return None;
    }
    mods.logo = true;
    mods.serialized.depressed |= 1 << logo;
    Some(mods)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn super_joins_the_modifiers_held_and_keeps_them() {
        let mut held = ModifiersState {
            shift: true,
            caps_lock: true,
            ..Default::default()
        };
        // Shift (bit 0) down, Caps Lock (bit 1) locked, as evdev's keymap numbers them.
        held.serialized.depressed = 0b1;
        held.serialized.locked = 0b10;
        held.serialized.layout_effective = 1;
        // Mod4, where evdev's keymap puts Super.
        let lent = with_super(held, 6).expect("a keymap with Super");
        assert!(lent.logo && lent.shift && lent.caps_lock);
        assert_eq!(lent.serialized.depressed, 0b100_0001);
        assert_eq!(lent.serialized.locked, 0b10);
        assert_eq!(lent.serialized.layout_effective, 1);
    }

    #[test]
    fn a_keymap_without_super_lends_nothing() {
        assert!(with_super(ModifiersState::default(), xkb::MOD_INVALID).is_none());
        assert!(with_super(ModifiersState::default(), 40).is_none());
    }

    #[test]
    fn evdev_names_super_mod4() {
        let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
        let Some(keymap) =
            xkb::Keymap::new_from_names(&context, "", "", "us", "", None, xkb::COMPILE_NO_FLAGS)
        else {
            // No xkeyboard-config on this machine: nothing to check against.
            return;
        };
        let logo = keymap.mod_get_index(xkb::MOD_NAME_LOGO);
        let lent = with_super(ModifiersState::default(), logo).expect("Super in evdev's keymap");
        assert_eq!(lent.serialized.depressed, 1 << keymap.mod_get_index("Mod4"));
    }
}
