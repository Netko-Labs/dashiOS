//! What a `type-text` request types (type_plan.rs).

use smithay::input::keyboard::Keycode;

use super::*;
use crate::ipc::protocol::WindowId;

/// The text alone, as groups.
fn typed(text: &str) -> Vec<Vec<Step>> {
    symbols(text).iter().map(|name| tap(name)).collect()
}

fn codes(run: &Run) -> Vec<u32> {
    run.keys.iter().map(|(code, _)| *code).collect()
}

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
    let all = runs(&typed("ana"));
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].symbols, ["a", "n"]);
    assert_eq!(codes(&all[0]), [9, 10, 9]);
}

#[test]
fn more_characters_than_a_keymap_holds_are_typed_in_runs() {
    let text: String = (0..300u32)
        .filter_map(|n| char::from_u32(0x4E00 + n))
        .collect();
    let all = runs(&typed(&text));
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].symbols.len(), MAX_KEYS);
    assert_eq!(all[0].keys.len() + all[1].keys.len(), 300);
}

#[test]
fn the_keymap_compiles_and_types_what_it_was_made_for() {
    let run = &runs(&typed("señor, ¿qué? Ça — 日本\n"))[0];
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
        .map(|(code, _)| state.key_get_utf8(Keycode::new(*code)))
        .collect();
    assert_eq!(typed, "señor, ¿qué? Ça — 日本\r");
}

#[test]
fn backspaces_come_first_and_a_line_break_is_the_chord_it_was_asked_as() {
    let params = TypeText {
        window: WindowId(1),
        text: "a\nb".into(),
        erase: 2,
        breaks: Some("shift+Return".into()),
    };
    let groups = plan(&params).expect("the chord reads");
    let steps: Vec<(&str, Press)> = groups
        .iter()
        .flatten()
        .map(|step| (step.symbol.as_str(), step.press))
        .collect();
    assert_eq!(
        steps,
        [
            ("BackSpace", Press::Tap),
            ("BackSpace", Press::Tap),
            ("a", Press::Tap),
            ("Shift_L", Press::Down),
            ("Return", Press::Tap),
            ("Shift_L", Press::Up),
            ("b", Press::Tap),
        ]
    );
    // The chord's modifier is held in the made keymap: Shift is down while Return goes.
    let run = &runs(&groups)[0];
    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    let keymap = xkb::Keymap::new_from_string(
        &context,
        keymap_for(&run.symbols),
        xkb::KEYMAP_FORMAT_TEXT_V1,
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    )
    .expect("the keymap compiles");
    let mut state = xkb::State::new(&keymap);
    let shift = run
        .symbols
        .iter()
        .position(|s| s == "Shift_L")
        .expect("a Shift key") as u32;
    state.update_key(Keycode::new(FIRST_KEYCODE + shift), xkb::KeyDirection::Down);
    assert!(state.mod_name_is_active(xkb::MOD_NAME_SHIFT, xkb::STATE_MODS_EFFECTIVE));
    assert!(
        plan(&TypeText {
            breaks: Some("hyper+Return".into()),
            ..params
        })
        .is_err()
    );
}

#[test]
fn erasing_alone_types_only_backspaces() {
    let params = TypeText {
        window: WindowId(1),
        text: String::new(),
        erase: 3,
        breaks: None,
    };
    assert_eq!(plan(&params).expect("no chord to read").len(), 3);
}
