//! GPUI's key names (what Metal's `onKeyDown` reports) to Ghostty's
//! physical keys, for the key encoder.

use crate::ffi_generated as ffi;

/// The Ghostty key for a GPUI key name, or `UNIDENTIFIED` (the encoder then
/// falls back to the text the key typed).
pub(crate) fn ghostty_key(name: &str) -> ffi::GhosttyKey {
    use ffi::*;
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return match c.to_ascii_lowercase() {
            'a'..='z' => GhosttyKey_GHOSTTY_KEY_A + (c.to_ascii_lowercase() as i32 - 'a' as i32),
            '0'..='9' => GhosttyKey_GHOSTTY_KEY_DIGIT_0 + (c as i32 - '0' as i32),
            '`' => GhosttyKey_GHOSTTY_KEY_BACKQUOTE,
            '\\' => GhosttyKey_GHOSTTY_KEY_BACKSLASH,
            '[' => GhosttyKey_GHOSTTY_KEY_BRACKET_LEFT,
            ']' => GhosttyKey_GHOSTTY_KEY_BRACKET_RIGHT,
            ',' => GhosttyKey_GHOSTTY_KEY_COMMA,
            '=' => GhosttyKey_GHOSTTY_KEY_EQUAL,
            '-' => GhosttyKey_GHOSTTY_KEY_MINUS,
            '.' => GhosttyKey_GHOSTTY_KEY_PERIOD,
            '\'' => GhosttyKey_GHOSTTY_KEY_QUOTE,
            ';' => GhosttyKey_GHOSTTY_KEY_SEMICOLON,
            '/' => GhosttyKey_GHOSTTY_KEY_SLASH,
            ' ' => GhosttyKey_GHOSTTY_KEY_SPACE,
            _ => GhosttyKey_GHOSTTY_KEY_UNIDENTIFIED,
        };
    }
    if let Some(n) = name
        .strip_prefix('f')
        .and_then(|n| n.parse::<i32>().ok())
        .filter(|n| (1..=24).contains(n))
    {
        return GhosttyKey_GHOSTTY_KEY_F1 + (n - 1);
    }
    match name {
        "enter" => GhosttyKey_GHOSTTY_KEY_ENTER,
        "escape" => GhosttyKey_GHOSTTY_KEY_ESCAPE,
        "backspace" => GhosttyKey_GHOSTTY_KEY_BACKSPACE,
        "tab" => GhosttyKey_GHOSTTY_KEY_TAB,
        "space" => GhosttyKey_GHOSTTY_KEY_SPACE,
        "delete" => GhosttyKey_GHOSTTY_KEY_DELETE,
        "insert" => GhosttyKey_GHOSTTY_KEY_INSERT,
        "home" => GhosttyKey_GHOSTTY_KEY_HOME,
        "end" => GhosttyKey_GHOSTTY_KEY_END,
        "pageup" => GhosttyKey_GHOSTTY_KEY_PAGE_UP,
        "pagedown" => GhosttyKey_GHOSTTY_KEY_PAGE_DOWN,
        "left" => GhosttyKey_GHOSTTY_KEY_ARROW_LEFT,
        "right" => GhosttyKey_GHOSTTY_KEY_ARROW_RIGHT,
        "up" => GhosttyKey_GHOSTTY_KEY_ARROW_UP,
        "down" => GhosttyKey_GHOSTTY_KEY_ARROW_DOWN,
        _ => GhosttyKey_GHOSTTY_KEY_UNIDENTIFIED,
    }
}

/// Ghostty's modifier bits.
pub(crate) fn mods(ctrl: bool, alt: bool, shift: bool, meta: bool) -> ffi::GhosttyMods {
    let mut bits = 0u32;
    if shift {
        bits |= ffi::GHOSTTY_MODS_SHIFT;
    }
    if ctrl {
        bits |= ffi::GHOSTTY_MODS_CTRL;
    }
    if alt {
        bits |= ffi::GHOSTTY_MODS_ALT;
    }
    if meta {
        bits |= ffi::GHOSTTY_MODS_SUPER;
    }
    bits as ffi::GhosttyMods
}

/// The codepoint the key types without Shift, for the Kitty protocol.
pub(crate) fn unshifted(name: &str) -> Option<u32> {
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => Some(c.to_ascii_lowercase() as u32),
        _ if name == "space" => Some(' ' as u32),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letters_digits_and_named_keys_map() {
        assert_eq!(ghostty_key("c"), ffi::GhosttyKey_GHOSTTY_KEY_C);
        assert_eq!(ghostty_key("C"), ffi::GhosttyKey_GHOSTTY_KEY_C);
        assert_eq!(ghostty_key("7"), ffi::GhosttyKey_GHOSTTY_KEY_DIGIT_7);
        assert_eq!(ghostty_key("enter"), ffi::GhosttyKey_GHOSTTY_KEY_ENTER);
        assert_eq!(ghostty_key("f12"), ffi::GhosttyKey_GHOSTTY_KEY_F12);
        assert_eq!(ghostty_key("left"), ffi::GhosttyKey_GHOSTTY_KEY_ARROW_LEFT);
        assert_eq!(ghostty_key("ü"), ffi::GhosttyKey_GHOSTTY_KEY_UNIDENTIFIED);
    }

    #[test]
    fn modifiers_combine() {
        assert_eq!(
            u32::from(mods(true, false, true, false)),
            ffi::GHOSTTY_MODS_CTRL | ffi::GHOSTTY_MODS_SHIFT
        );
    }
}
