//! `type-text`: words typed into the window that has the keyboard, whatever
//! the layout (dictation; docs/compositor-ipc.md, "Keys"). The layout may
//! have no key for ñ or é, so for a moment the keyboard is given a keymap made
//! for the text, one key for each character in it; the keys are pressed, and
//! the person's layout is put back. The client reads all three in order, as
//! it would a change of layout. Nothing touches the clipboard, and no
//! backspace is ever sent.
//!
//! Refused, with nothing typed: while locked; when `window` no longer has
//! the keyboard (`left-window`); for an X11 window, whose keymap changes too
//! slowly to trust (`x11`); while the person holds a key down (`keys-down`:
//! its release would land in the wrong keymap); text with nothing to type.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use smithay::{
    input::keyboard::{Keycode, xkb},
    wayland::input_method::InputMethodSeat,
};

use crate::{ipc::protocol::WindowId, session::agent_keys::key_route, state::Dashi};

/// At most this many characters at once.
const MAX_TEXT: usize = 8192;
/// A keymap's keys: X11's limit of 255 keycodes, from 9.
const MAX_KEYS: usize = 240;
const FIRST_KEYCODE: u32 = 9;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TypeText {
    pub window: WindowId,
    pub text: String,
}

/// The keysym names for `text`, one for each character typed: a line break
/// is Return, a tab is Tab, and what no key can be (other control characters)
/// is left out.
fn symbols(text: &str) -> Vec<String> {
    let mut after_return = false;
    let mut names = Vec::new();
    for ch in text.chars() {
        let pair = ch == '\n' && after_return;
        after_return = ch == '\r';
        if pair {
            continue;
        }
        match ch {
            '\n' | '\r' => names.push("Return".to_owned()),
            '\t' => names.push("Tab".to_owned()),
            ch if ch.is_control() => {}
            ch => {
                let sym = xkb::utf32_to_keysym(ch as u32);
                if sym.raw() != xkb::keysyms::KEY_NoSymbol {
                    names.push(xkb::keysym_get_name(sym));
                }
            }
        }
    }
    names
}

/// A run of the text and the keymap that types it: the keymap's symbols (the
/// key at `FIRST_KEYCODE + n` types the nth), and the key for each character.
struct Run {
    symbols: Vec<String>,
    keys: Vec<u32>,
}

/// The text in runs of at most `MAX_KEYS` different characters each.
fn runs(names: &[String]) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for name in names {
        let fits = runs
            .last()
            .is_some_and(|run| run.symbols.len() < MAX_KEYS || run.symbols.contains(name));
        if !fits {
            runs.push(Run {
                symbols: Vec::new(),
                keys: Vec::new(),
            });
        }
        let Some(run) = runs.last_mut() else {
            continue;
        };
        let at = run
            .symbols
            .iter()
            .position(|symbol| symbol == name)
            .unwrap_or_else(|| {
                run.symbols.push(name.clone());
                run.symbols.len() - 1
            });
        run.keys.push(FIRST_KEYCODE + at as u32);
    }
    runs
}

/// An xkb keymap whose key `FIRST_KEYCODE + n` types the nth symbol, on every level.
fn keymap_for(symbols: &[String]) -> String {
    let mut codes = String::new();
    let mut keys = String::new();
    for (index, symbol) in symbols.iter().enumerate() {
        let _ = writeln!(codes, "<K{index}> = {};", FIRST_KEYCODE + index as u32);
        let _ = writeln!(keys, "key <K{index}> {{[{symbol}]}};");
    }
    format!(
        "xkb_keymap {{\n\
         xkb_keycodes \"dashi\" {{\nminimum = 8;\nmaximum = {};\n{codes}}};\n\
         xkb_types \"dashi\" {{ include \"complete\" }};\n\
         xkb_compatibility \"dashi\" {{ include \"complete\" }};\n\
         xkb_symbols \"dashi\" {{\n{keys}}};\n\
         }};\n",
        FIRST_KEYCODE + symbols.len() as u32 + 1
    )
}

impl Dashi {
    /// `type-text {window, text}`.
    pub(crate) fn type_text(&mut self, params: &TypeText) -> Result<(), String> {
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        if params.text.chars().count() > MAX_TEXT {
            return Err("too much text at once".into());
        }
        let id = params.window.0;
        if self.focused_window_id() != Some(id) {
            return Err("left-window".into());
        }
        let x11 = self
            .windows
            .get(id)
            .is_some_and(|entry| entry.window.x11_surface().is_some());
        if x11 {
            return Err("x11".into());
        }
        let keyboard = self.seat.get_keyboard().ok_or("the seat has no keyboard")?;
        let surface = keyboard.current_focus().ok_or("left-window")?;
        if !keyboard.pressed_keys().is_empty() {
            return Err("keys-down".into());
        }
        let names = symbols(&params.text);
        if names.is_empty() {
            return Err("nothing to type".into());
        }
        let time = u32::try_from(self.start_time.elapsed().as_millis()).unwrap_or(u32::MAX);
        let route = key_route(self.seat.input_method().keyboard_grabbed());
        let mut result = Ok(());
        for run in runs(&names) {
            if keyboard
                .set_keymap_from_string(self, keymap_for(&run.symbols))
                .is_err()
            {
                result = Err("the keymap for this text does not compile".to_owned());
                break;
            }
            for code in run.keys {
                let code = Keycode::new(code);
                self.agent_key(&keyboard, &surface, route, code, true, time);
                self.agent_key(&keyboard, &surface, route, code, false, time);
            }
        }
        // The person's layout again, whatever happened.
        self.restore_layout();
        self.keys.snippets.reset();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_character_has_a_symbol_and_a_line_break_is_return() {
        assert_eq!(
            symbols("ñ é\n¿\r\n\t"),
            [
                "ntilde",
                "space",
                "eacute",
                "Return",
                "questiondown",
                "Return",
                "Tab"
            ]
        );
        // What no key types is left out, never guessed.
        assert_eq!(symbols("a\u{7}b"), ["a", "b"]);
        assert_eq!(symbols("\u{1F600}"), ["U1F600"]);
    }

    #[test]
    fn a_character_typed_twice_is_one_key() {
        let all = runs(&symbols("ana"));
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].symbols, ["a", "n"]);
        assert_eq!(all[0].keys, [9, 10, 9]);
    }

    #[test]
    fn more_characters_than_a_keymap_holds_are_typed_in_runs() {
        let text: String = (0..300u32)
            .filter_map(|n| char::from_u32(0x4E00 + n))
            .collect();
        let all = runs(&symbols(&text));
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].symbols.len(), MAX_KEYS);
        assert_eq!(all[0].keys.len() + all[1].keys.len(), 300);
    }

    #[test]
    fn the_keymap_compiles_and_types_what_it_was_made_for() {
        let names = symbols("señor, ¿qué? Ça — 日本\n");
        let run = &runs(&names)[0];
        let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
        let keymap = xkb::Keymap::new_from_string(
            &context,
            keymap_for(&run.symbols),
            xkb::KEYMAP_FORMAT_TEXT_V1,
            xkb::KEYMAP_COMPILE_NO_FLAGS,
        )
        .expect("the keymap compiles");
        let state = xkb::State::new(&keymap);
        let typed: String = run
            .keys
            .iter()
            .map(|code| state.key_get_utf8(Keycode::new(*code)))
            .collect();
        assert_eq!(typed, "señor, ¿qué? Ça — 日本\r");
    }
}
