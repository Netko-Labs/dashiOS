//! Matching: modifiers, alternatives, apps; parsing chords and refusing mistakes.

use super::*;

#[test]
fn exact_modifiers_and_shift_only_when_named() {
    let map = keymap();
    assert_eq!(
        action(&map, &["q", "q"], SUPER, "x"),
        Some(Action::Bind("quit-app".into()))
    );
    // Shift is not named in super+q, so it does not stop the match.
    assert_eq!(
        action(
            &map,
            &["q", "Q"],
            Mods {
                shift: true,
                ..SUPER
            },
            "x"
        ),
        Some(Action::Bind("quit-app".into()))
    );
    // Unshifted name: ⇧❖3 is "3", not "numbersign".
    let shifted = Mods {
        shift: true,
        ..SUPER
    };
    assert_eq!(
        action(&map, &["3", "numbersign"], shifted, "x"),
        Some(Action::Bind("screenshot-screen".into()))
    );
    // Ctrl must match exactly: ❖⌃Q is swallowed, not quit.
    assert_eq!(
        action(
            &map,
            &["q", "q"],
            Mods {
                ctrl: true,
                ..SUPER
            },
            "x"
        ),
        Some(Action::Swallow)
    );
    assert_eq!(
        action(
            &map,
            &["XF86AudioMute", "XF86AudioMute"],
            Mods::default(),
            ""
        ),
        Some(Action::Bind("volume-mute".into()))
    );
    assert_eq!(action(&map, &["a", "a"], Mods::default(), "x"), None);
}

#[test]
fn alternatives_order_and_apps() {
    let map = keymap();
    assert_eq!(
        action(
            &map,
            &["Tab", "ISO_Left_Tab"],
            Mods {
                shift: true,
                ..SUPER
            },
            "x"
        ),
        Some(Action::Bind("switch-previous".into()))
    );
    assert_eq!(
        action(&map, &["Tab", "Tab"], SUPER, "x"),
        Some(Action::Bind("switch-next".into()))
    );
    assert_eq!(
        action(&map, &["BackSpace"], SUPER, "foot"),
        Some(Action::Tap(vec![Chord::parse("ctrl+u").unwrap()]))
    );
    assert_eq!(
        action(&map, &["BackSpace"], SUPER, "org.gnome.TextEditor")
            .map(|a| matches!(a, Action::Tap(c) if c.len() == 2)),
        Some(true)
    );
    assert_eq!(
        action(&map, &["s"], SUPER, "dev.dashi.files"),
        Some(Action::Bind("app-chord".into()))
    );
    assert_eq!(
        action(&map, &["s"], SUPER, ""),
        Some(Action::Bind("app-chord".into()))
    );
    assert_eq!(
        action(&map, &["s"], SUPER, "foot"),
        Some(Action::Send(Chord::parse("ctrl+shift+key").unwrap()))
    );
    assert_eq!(
        action(&map, &["s"], SUPER, "firefox"),
        Some(Action::Send(Chord::parse("ctrl+key").unwrap()))
    );
    assert_eq!(
        action(&map, &["Left"], SUPER, "firefox"),
        Some(Action::Send(Chord::parse("Home").unwrap()))
    );
}

#[test]
fn chords_parse() {
    let chord = Chord::parse("ctrl+shift+key").unwrap();
    assert_eq!(chord.key, KeyRef::Pressed);
    assert!(chord.mods.ctrl && chord.mods.shift && !chord.mods.alt);
    assert_eq!(
        Chord::parse("Home").unwrap().key,
        KeyRef::Named("Home".into())
    );
    assert!(Chord::parse("hyper+x").is_err());
    assert!(Chord::parse("ctrl+").is_err());
}

#[test]
fn mistakes_are_refused_with_where() {
    let bad = |rules: Value| parse(json!({ "rules": rules }).as_object().unwrap()).unwrap_err();
    assert!(bad(json!([{ "when": "super+q" }])).starts_with("rule 0:"));
    assert!(bad(json!([{ "when": "meta+q", "bind": "x" }])).contains("meta"));
    assert!(bad(json!([{ "when": "q", "app": "nope", "bind": "x" }])).contains("class"));
    assert!(parse(json!({}).as_object().unwrap()).is_err());
    let after = parse(
        json!({ "rules": [], "afterTap": [{ "when": "q" }] })
            .as_object()
            .unwrap(),
    )
    .unwrap_err();
    assert!(after.starts_with("afterTap 0:"), "{after}");
    assert!(parse(json!({ "rules": [], "afterTap": {} }).as_object().unwrap()).is_err());
}
