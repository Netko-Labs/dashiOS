//! What a key is and which key types what, read from xkb: a pressed key's
//! names and text, and the keycode (and modifiers) that type a chord or a keysym
//! in the person's layout.

use smithay::input::keyboard::{Keycode, KeysymHandle, ModifiersState, keysyms, xkb};

use super::keymap::{Chord, KeyRef};
use crate::state::Dashi;

/// What a key is, read from xkb as it is pressed.
pub(super) struct KeyInfo {
    /// Unshifted keysym names first, then the keysym as typed.
    pub(super) names: Vec<String>,
    /// What the key types with these modifiers ("a", "A", "é"), if it types anything.
    pub(super) text: Option<String>,
    pub(super) mods: ModifiersState,
    pub(super) is_modifier: bool,
    pub(super) function_key: Option<u32>,
}

impl Dashi {
    /// The keycode and modifiers that type `chord` in the current layout.
    pub(super) fn resolve(
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
}

pub(super) fn key_info(mods: &ModifiersState, handle: &KeysymHandle<'_>) -> KeyInfo {
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
        text: typed_text(typed),
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

/// The text a keysym types: a printable character, never a control one (Return, Tab, Esc).
fn typed_text(sym: xkb::Keysym) -> Option<String> {
    sym.key_char()
        .filter(|char| !char.is_control())
        .map(String::from)
}

#[cfg(test)]
mod tests {
    use super::typed_text;
    use smithay::input::keyboard::{keysyms, xkb::Keysym};

    #[test]
    fn keys_type_their_characters_and_nothing_for_control_keys() {
        assert_eq!(
            typed_text(Keysym::new(keysyms::KEY_a)).as_deref(),
            Some("a")
        );
        assert_eq!(
            typed_text(Keysym::new(keysyms::KEY_A)).as_deref(),
            Some("A")
        );
        assert_eq!(
            typed_text(Keysym::new(keysyms::KEY_eacute)).as_deref(),
            Some("é")
        );
        assert_eq!(
            typed_text(Keysym::new(keysyms::KEY_space)).as_deref(),
            Some(" ")
        );
        assert_eq!(typed_text(Keysym::new(keysyms::KEY_Return)), None);
        assert_eq!(typed_text(Keysym::new(keysyms::KEY_BackSpace)), None);
        assert_eq!(typed_text(Keysym::new(keysyms::KEY_Escape)), None);
        assert_eq!(typed_text(Keysym::new(keysyms::KEY_Left)), None);
    }
}
