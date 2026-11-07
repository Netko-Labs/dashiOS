//! A click with ❖ held: the clicked window hears Super with it.
//!
//! ❖ is Dashi's (handler.rs): its key never reaches a client, so xkb's state
//! never holds it, and a ❖-click arrived in apps as a plain click (Files'
//! ❖-click, which adds an item to the selection as ⌘-click does on the Mac,
//! selected it alone). While a button is down with ❖ held, the client that
//! takes the click and has the keyboard gets the person's modifiers with
//! Super (Mod4, xkb's "Super"/logo) added, as one `wl_keyboard.modifiers`; when
//! that button comes up, after its release, it gets the real state back.
//! Nothing else changes: the compositor's own xkb state, and so the keymap's
//! matching, never sees Super.

use smithay::{
    input::keyboard::{KeyboardTarget, ModifiersState, xkb},
    reexports::wayland_server::Resource,
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    /// A button went down on a client: with ❖ held, lend it Super until the button comes up.
    pub(crate) fn lend_super(&mut self, button: u32) {
        if !self.keys.super_is_down() || self.keys.lent_super.is_some() {
            return;
        }
        let (Some(keyboard), Some(pointer)) = (self.seat.get_keyboard(), self.seat.get_pointer())
        else {
            return;
        };
        let (Some(focus), Some(under)) = (keyboard.current_focus(), pointer.current_focus()) else {
            return;
        };
        // Only the window taking the click: a panel that leaves the keyboard where it was isn't it.
        if !focus.id().same_client_as(&under.id()) {
            return;
        }
        let logo = keyboard.with_xkb_state(self, |context| {
            let xkb = context.xkb().lock().ok()?;
            // SAFETY: the keymap is only read while the Xkb lock is held.
            let keymap = unsafe { xkb.keymap() };
            Some(keymap.mod_get_index(xkb::MOD_NAME_LOGO))
        });
        let Some(mods) = logo.and_then(|index| with_super(keyboard.modifier_state(), index)) else {
            return;
        };
        let seat = self.seat.clone();
        focus.modifiers(&seat, self, mods, SERIAL_COUNTER.next_serial());
        self.keys.lent_super = Some(button);
    }

    /// A button came up: if it was a ❖-click, the client hears the modifiers as they are again.
    pub(crate) fn return_super(&mut self, button: u32) {
        if self.keys.lent_super != Some(button) {
            return;
        }
        self.keys.lent_super = None;
        let Some(keyboard) = self.seat.get_keyboard() else {
            return;
        };
        let Some(focus) = keyboard.current_focus() else {
            return;
        };
        let seat = self.seat.clone();
        let mods = keyboard.modifier_state();
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
