//! What a `type-text` request types, worked out before a key is pressed
//! (type_text.rs): the BackSpaces, each character, a line break as the
//! chord it was asked as; in runs that each fit one keymap, and the keymap
//! made for a run.

use std::fmt::Write as _;

use smithay::input::keyboard::xkb;

use super::type_text::TypeText;

/// A keymap's keys: X11's limit of 255 keycodes, from 9.
const MAX_KEYS: usize = 240;
const FIRST_KEYCODE: u32 = 9;

/// How a key of the made keymap is pressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Press {
    Tap,
    Down,
    Up,
}

/// One key of what is typed: its keysym's name, and how it is pressed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Step {
    symbol: String,
    press: Press,
}

fn tap(symbol: &str) -> Vec<Step> {
    vec![Step {
        symbol: symbol.to_owned(),
        press: Press::Tap,
    }]
}

/// The keysym a modifier of a chord is held with.
fn modifier_symbol(name: &str) -> Option<&'static str> {
    match name {
        "shift" => Some("Shift_L"),
        "ctrl" => Some("Control_L"),
        "alt" => Some("Alt_L"),
        _ => None,
    }
}

/// A chord as keys: its modifiers go down, its key is tapped, they come up.
fn chord_steps(chord: &str) -> Result<Vec<Step>, String> {
    let mut parts: Vec<&str> = chord.split('+').collect();
    let key = parts
        .pop()
        .filter(|key| !key.is_empty())
        .ok_or_else(|| format!("{chord:?} has no key"))?;
    let mods = parts
        .iter()
        .map(|part| {
            modifier_symbol(part).ok_or_else(|| format!("{chord:?}: unknown modifier {part:?}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let held = |press| {
        mods.iter().map(move |symbol| Step {
            symbol: (*symbol).to_owned(),
            press,
        })
    };
    Ok(held(Press::Down)
        .chain(tap(key))
        .chain(held(Press::Up))
        .collect())
}

/// Everything a request types, in groups that are never split between two keymaps:
/// the BackSpaces, then each character, a line break as `breaks` says.
pub(super) fn plan(params: &TypeText) -> Result<Vec<Vec<Step>>, String> {
    let line_break = params.breaks.as_deref().map(chord_steps).transpose()?;
    let mut groups: Vec<Vec<Step>> = (0..params.erase).map(|_| tap("BackSpace")).collect();
    for name in symbols(&params.text) {
        match (&line_break, name.as_str()) {
            (Some(chord), "Return") => groups.push(chord.clone()),
            _ => groups.push(tap(&name)),
        }
    }
    Ok(groups)
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
pub(super) struct Run {
    pub symbols: Vec<String>,
    pub keys: Vec<(u32, Press)>,
}

/// The groups in runs of at most `MAX_KEYS` different keys each; a group is whole in one run.
pub(super) fn runs(groups: &[Vec<Step>]) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for group in groups {
        let fits = runs.last().is_some_and(|run| {
            let new = group
                .iter()
                .filter(|step| !run.symbols.contains(&step.symbol))
                .count();
            run.symbols.len() + new <= MAX_KEYS
        });
        if !fits {
            runs.push(Run {
                symbols: Vec::new(),
                keys: Vec::new(),
            });
        }
        let Some(run) = runs.last_mut() else {
            continue;
        };
        for step in group {
            let at = run
                .symbols
                .iter()
                .position(|symbol| symbol == &step.symbol)
                .unwrap_or_else(|| {
                    run.symbols.push(step.symbol.clone());
                    run.symbols.len() - 1
                });
            run.keys.push((FIRST_KEYCODE + at as u32, step.press));
        }
    }
    runs
}

/// An xkb keymap whose key `FIRST_KEYCODE + n` types the nth symbol, on every level;
/// a modifier's key holds its modifier.
pub(super) fn keymap_for(symbols: &[String]) -> String {
    let mut codes = String::new();
    let mut keys = String::new();
    for (index, symbol) in symbols.iter().enumerate() {
        let _ = writeln!(codes, "<K{index}> = {};", FIRST_KEYCODE + index as u32);
        let _ = writeln!(keys, "key <K{index}> {{[{symbol}]}};");
        let modifier = match symbol.as_str() {
            "Shift_L" => Some("Shift"),
            "Control_L" => Some("Control"),
            "Alt_L" => Some("Mod1"),
            _ => None,
        };
        if let Some(modifier) = modifier {
            let _ = writeln!(keys, "modifier_map {modifier} {{ <K{index}> }};");
        }
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

#[cfg(test)]
mod tests;
