//! The `afterTap` rules: armed by a ❖ tap or by a bind that says so, held until the next keymap.

use super::*;

#[test]
fn after_a_tap_the_after_tap_rules_hold_until_the_next_keymap() {
    let mut map = parse(
        json!({
            "rules": [{ "when": "XF86AudioMute", "bind": "volume-mute" }],
            "afterTap": [
                { "when": "XF86AudioMute", "bind": "volume-mute" },
                { "when": "*", "bind": "launcher-type" }
            ]
        })
        .as_object()
        .unwrap(),
    )
    .unwrap();
    let plain = Mods::default();
    assert_eq!(action(&map, &["a"], plain, "firefox"), None);
    assert!(map.arm_after_tap());
    assert_eq!(
        action(&map, &["a"], plain, "firefox"),
        Some(Action::Bind("launcher-type".into()))
    );
    // Shift isn't named, so a capital is typed too; a chord with Ctrl is not.
    assert_eq!(
        action(
            &map,
            &["a", "A"],
            Mods {
                shift: true,
                ..plain
            },
            "firefox"
        ),
        Some(Action::Bind("launcher-type".into()))
    );
    assert_eq!(
        action(
            &map,
            &["c"],
            Mods {
                ctrl: true,
                ..plain
            },
            "firefox"
        ),
        None
    );
    assert_eq!(
        action(&map, &["XF86AudioMute"], plain, "firefox"),
        Some(Action::Bind("volume-mute".into()))
    );
    // Once: a second tap keeps what the first switched to.
    assert!(!map.arm_after_tap());
    let mut none = parse(json!({ "rules": [] }).as_object().unwrap()).unwrap();
    assert!(!none.arm_after_tap());
}

/// What handler.rs does with a key: its action, and the `afterTap` rules armed when the rule says so.
fn press(map: &mut Keymap, names: &[&str], mods: Mods) -> Option<Action> {
    let names: Vec<String> = names.iter().map(|n| n.to_string()).collect();
    let pressed = Pressed {
        names: &names,
        mods,
        app_id: "foot",
    };
    let (action, arms) = map.matched(&pressed).map(|(a, arms)| (a.clone(), arms))?;
    if arms {
        map.arm_after_tap();
    }
    Some(action)
}

#[test]
fn a_binding_that_arms_after_tap_hands_the_next_keys_to_the_shell_at_once() {
    let mut map = parse(
        json!({
            "rules": [{ "when": "super+space", "bind": "launcher", "armsAfterTap": true }],
            "afterTap": [
                { "when": "super+space", "bind": "launcher" },
                { "when": "*", "bind": "launcher-type" }
            ]
        })
        .as_object()
        .unwrap(),
    )
    .unwrap();
    let plain = Mods::default();
    // Before ❖Space a letter is the window's.
    assert_eq!(press(&mut map, &["s"], plain), None);
    // ❖Space, then the letters queued behind it (the compositor was busy): all typed ahead.
    assert_eq!(
        press(&mut map, &["space"], SUPER),
        Some(Action::Bind("launcher".into()))
    );
    for letter in ["s", "c", "r"] {
        assert_eq!(
            press(&mut map, &[letter], plain),
            Some(Action::Bind("launcher-type".into()))
        );
    }
    // ❖Space again (closing it) arms nothing more: the shell's next keymap decides.
    assert_eq!(
        press(&mut map, &["space"], SUPER),
        Some(Action::Bind("launcher".into()))
    );
    assert!(!map.arm_after_tap());
}

/// The keymaps the shell sends around one launcher round (launcher/type-ahead.ts, main.tsx):
/// idle (❖Space arms the typing), typing while it opens, the open launcher's, idle again.
fn shell_keymap(kind: &str) -> Keymap {
    let typing = json!([
        { "when": "Home", "bind": "launcher-first" },
        { "when": "super+space", "bind": "launcher" },
        { "when": "*", "bind": "launcher-type" }
    ]);
    let params = match kind {
        "idle" => json!({
            "rules": [{ "when": "super+space", "bind": "launcher", "armsAfterTap": true }],
            "afterTap": typing
        }),
        "typing" => json!({ "rules": typing }),
        _ => json!({
            "rules": [
                { "when": "Home", "bind": "launcher-first" },
                { "when": "super+space", "bind": "launcher" }
            ]
        }),
    };
    parse(params.as_object().unwrap()).unwrap()
}

#[test]
fn every_idle_keymap_arms_the_next_launcher_key_again() {
    // Review 17: ❖Space, x, Esc, then ❖Space and "snip" at once, ten times over. Each round
    // the shell sends typing, then the open launcher's keys, then idle once it closes; the
    // ❖Space of every round must hand the letters behind it to the shell, never the window.
    let typed = Some(Action::Bind("launcher-type".into()));
    let mut map = shell_keymap("idle");
    for round in 0..10 {
        assert_eq!(
            press(&mut map, &["space"], SUPER),
            Some(Action::Bind("launcher".into())),
            "round {round}"
        );
        for letter in ["s", "n", "i", "p"] {
            assert_eq!(
                press(&mut map, &[letter], Mods::default()),
                typed,
                "round {round}: {letter} before the shell answered"
            );
        }
        map = shell_keymap("typing");
        assert_eq!(press(&mut map, &["x"], Mods::default()), typed);
        // The field has the keyboard: Esc and letters are its own.
        map = shell_keymap("open");
        assert_eq!(press(&mut map, &["Escape"], Mods::default()), None);
        map = shell_keymap("idle");
    }
}

#[test]
fn only_a_bind_arms_after_tap() {
    let refused = |rule: Value| parse(json!({ "rules": [rule] }).as_object().unwrap()).unwrap_err();
    assert!(
        refused(json!({ "when": "super+space", "send": "ctrl+space", "armsAfterTap": true }))
            .contains("only a bind")
    );
    assert!(
        refused(json!({ "when": "super+space", "bind": "launcher", "armsAfterTap": 1 }))
            .contains("expected a boolean")
    );
    // Without afterTap rules there is nothing to arm: the binding is all it does.
    let mut map = parse(
        json!({ "rules": [{ "when": "super+space", "bind": "launcher", "armsAfterTap": true }] })
            .as_object()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        press(&mut map, &["space"], SUPER),
        Some(Action::Bind("launcher".into()))
    );
    assert_eq!(press(&mut map, &["s"], Mods::default()), None);
}
