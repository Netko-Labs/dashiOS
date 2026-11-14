use std::time::Duration;

use super::*;

fn key(name: &str, code: i64, bare: bool) -> HeldKey {
    HeldKey {
        name: name.into(),
        code: Int::new(code).expect("a key code"),
        bare: bare.then_some(true),
        alone: None,
        with_super: None,
        tap_ms: None,
    }
}

fn alone(name: &str, code: i64) -> HeldKey {
    HeldKey {
        alone: Some(true),
        ..key(name, code, false)
    }
}

fn with_super(name: &str, code: i64, tap_ms: i64) -> HeldKey {
    HeldKey {
        with_super: Some(true),
        tap_ms: Some(Int::new(tap_ms).expect("a tap's length")),
        ..key(name, code, false)
    }
}

fn held(keys: Vec<HeldKey>) -> HeldKeys {
    let mut held = HeldKeys::default();
    held.set(&HeldKeysParams { keys })
        .expect("the keys are fine");
    held
}

const NONE: ModsDown = ModsDown {
    logo: false,
    other: false,
};
const OTHER: ModsDown = ModsDown {
    logo: false,
    other: true,
};
const LOGO: ModsDown = ModsDown {
    logo: true,
    other: false,
};

fn taken(name: &str) -> Option<Taken> {
    Some(Taken::Down(name.into(), true))
}

fn up(name: &str, chord: bool, tap: Option<bool>) -> Up {
    Up {
        name: name.into(),
        chord,
        tap,
    }
}

#[test]
fn a_listed_key_is_taken_down_and_up_by_its_evdev_code() {
    let now = Instant::now();
    let mut keys = held(vec![key("talk", 126, false), key("talk", 193, false)]);
    // KEY_RIGHTMETA is 126: xkb's 134.
    assert_eq!(keys.press(134, false, NONE, now), taken("talk"));
    assert_eq!(keys.press(134, false, NONE, now), Some(Taken::Again(true)));
    assert_eq!(
        keys.release(134, now),
        Some((Some(up("talk", false, None)), true))
    );
    assert_eq!(keys.release(134, now), None);
    // A Copilot key's F23 comes with ⇧ and ❖ held: still taken.
    let both = ModsDown {
        logo: true,
        other: true,
    };
    assert_eq!(keys.press(201, false, both, now), taken("talk"));
    assert_eq!(keys.press(38, false, NONE, now), None);
    // Another key under a plain held key is no chord: it has none.
    assert!(keys.chorded(now).is_empty());
}

#[test]
fn a_bare_key_gives_way_to_a_chord() {
    let now = Instant::now();
    let mut keys = held(vec![key("stop", 1, true)]);
    assert_eq!(keys.press(9, false, OTHER, now), None);
    assert_eq!(keys.release(9, now), None);
    assert_eq!(keys.press(9, false, NONE, now), taken("stop"));
}

#[test]
fn nothing_is_taken_while_locked_but_a_key_down_still_comes_up() {
    let now = Instant::now();
    let mut keys = held(vec![key("talk", 126, false)]);
    assert_eq!(keys.press(134, true, NONE, now), None);
    assert_eq!(keys.press(134, false, NONE, now), taken("talk"));
    // The list changes (and the screen locks) while it is down: its release is still the shell's.
    keys.set(&HeldKeysParams { keys: vec![] })
        .expect("an empty list");
    assert_eq!(
        keys.release(134, now),
        Some((Some(up("talk", false, None)), true))
    );
    assert_eq!(keys.press(134, false, NONE, now), None);
}

#[test]
fn a_key_held_alone_is_heard_and_still_the_apps() {
    let now = Instant::now();
    // KEY_RIGHTALT is 100: xkb's 108.
    let mut keys = held(vec![alone("dictation", 100)]);
    assert_eq!(
        keys.press(108, false, NONE, now),
        Some(Taken::Down("dictation".into(), false))
    );
    assert_eq!(keys.press(108, false, NONE, now), Some(Taken::Again(false)));
    assert_eq!(
        keys.release(108, now),
        Some((Some(up("dictation", false, None)), false))
    );
    // With a modifier already down it is that chord's, and nothing is heard.
    assert_eq!(keys.press(108, false, OTHER, now), None);
    assert_eq!(keys.press(108, false, LOGO, now), None);
}

#[test]
fn another_key_under_a_key_held_alone_is_a_chord_told_once() {
    let now = Instant::now();
    let mut keys = held(vec![alone("dictation", 100)]);
    keys.press(108, false, NONE, now);
    assert_eq!(keys.chorded(now), vec![up("dictation", true, None)]);
    assert!(keys.chorded(now).is_empty());
    // Its own release says nothing more, and it still goes to the app.
    assert_eq!(keys.release(108, now), Some((None, false)));
}

#[test]
fn a_key_with_super_is_taken_only_under_super_alone() {
    let now = Instant::now();
    // KEY_SPACE is 57: xkb's 65.
    let mut keys = held(vec![with_super("dashi", 57, 300)]);
    assert_eq!(keys.press(65, false, NONE, now), None);
    let shifted = ModsDown {
        logo: true,
        other: true,
    };
    assert_eq!(keys.press(65, false, shifted, now), None);
    assert_eq!(keys.press(65, false, LOGO, now), taken("dashi"));
    // Up soon, with nothing else: a tap.
    let soon = now + Duration::from_millis(120);
    assert_eq!(
        keys.release(65, soon),
        Some((Some(up("dashi", false, Some(true))), true))
    );
    // Held: no tap.
    keys.press(65, false, LOGO, now);
    let late = now + Duration::from_millis(900);
    assert_eq!(
        keys.release(65, late),
        Some((Some(up("dashi", false, Some(false))), true))
    );
}

#[test]
fn super_coming_up_first_ends_the_key_held_with_it() {
    let now = Instant::now();
    let mut keys = held(vec![with_super("dashi", 57, 300), alone("dictation", 100)]);
    keys.press(65, false, LOGO, now);
    let late = now + Duration::from_millis(900);
    assert_eq!(keys.super_up(late), vec![up("dashi", false, Some(false))]);
    assert!(keys.super_up(late).is_empty());
    // The key itself is still kept from the app as it comes up, and says nothing twice.
    assert_eq!(keys.release(65, late), Some((None, true)));
    // A chord is never a tap, however short.
    keys.press(65, false, LOGO, now);
    assert_eq!(keys.chorded(now), vec![up("dashi", true, Some(false))]);
}

#[test]
fn a_bad_list_is_refused_whole() {
    let now = Instant::now();
    let mut keys = held(vec![key("talk", 126, false)]);
    let twice = HeldKeysParams {
        keys: vec![key("a", 1, false), key("b", 1, false)],
    };
    assert!(keys.set(&twice).is_err());
    let unnamed = HeldKeysParams {
        keys: vec![key("", 1, false)],
    };
    assert!(keys.set(&unnamed).is_err());
    let shouting = HeldKeysParams {
        keys: vec![key("Talk Key", 1, false)],
    };
    assert!(keys.set(&shouting).is_err());
    let many = HeldKeysParams {
        keys: (1..=17).map(|code| key("k", code, false)).collect(),
    };
    assert!(keys.set(&many).is_err());
    let both = HeldKeysParams {
        keys: vec![HeldKey {
            bare: Some(true),
            ..alone("a", 1)
        }],
    };
    assert!(keys.set(&both).is_err());
    // What was held before a refusal is held still.
    assert_eq!(keys.press(134, false, NONE, now), taken("talk"));
}
