//! A chord as the keymap writes it (`ctrl+shift+z`, `Home`, `ctrl+key`), and
//! the modifiers it names.

/// Modifiers as the keymap names them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Mods {
    pub super_: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// A key in a chord: one keysym by name, or the key that was pressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum KeyRef {
    Named(String),
    Pressed,
}

/// `ctrl+shift+z`, `Home`, `ctrl+key`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Chord {
    pub mods: Mods,
    pub key: KeyRef,
}

impl Chord {
    pub(crate) fn parse(text: &str) -> Result<Self, String> {
        let mut mods = Mods::default();
        let mut parts: Vec<&str> = text.split('+').collect();
        let key = parts
            .pop()
            .filter(|key| !key.is_empty())
            .ok_or_else(|| format!("{text:?} has no key"))?;
        for part in parts {
            set_mod(&mut mods, part)
                .ok_or_else(|| format!("{text:?}: unknown modifier {part:?}"))?;
        }
        let key = if key == "key" {
            KeyRef::Pressed
        } else {
            KeyRef::Named(key.to_owned())
        };
        Ok(Self { mods, key })
    }
}

pub(super) fn set_mod(mods: &mut Mods, name: &str) -> Option<()> {
    match name {
        "super" => mods.super_ = true,
        "ctrl" => mods.ctrl = true,
        "alt" => mods.alt = true,
        "shift" => mods.shift = true,
        _ => return None,
    }
    Some(())
}
