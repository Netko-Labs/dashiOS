//! While locked: only the `locked` rules apply, and none binds.

use super::*;

#[test]
fn while_locked_only_the_locked_rules_apply_and_none_binds() {
    let map = parse(
        json!({
            "apps": { "metal": ["dev.dashi.*"] },
            "rules": [
                { "when": "super+*", "app": "metal", "bind": "app-chord" },
                { "when": "super+*", "send": "ctrl+key" },
                { "when": "XF86AudioMute", "bind": "volume-mute" }
            ],
            "locked": [
                { "when": "super+a|c|x|v|z", "send": "ctrl+key" },
                { "when": "super+BackSpace", "tap": ["shift+Home", "BackSpace"] },
                { "when": "super+*", "swallow": true }
            ]
        })
        .as_object()
        .unwrap(),
    )
    .unwrap();
    let locked = |names: &[&str], mods: Mods| {
        let names: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        map.action_while_locked(&Pressed {
            names: &names,
            mods,
            app_id: "",
        })
        .cloned()
    };
    let ctrl_key = Some(Action::Send(Chord::parse("ctrl+key").unwrap()));
    // ❖A selects in the lock screen's field; Shift held passes through (⇧❖Z).
    assert_eq!(locked(&["a"], SUPER), ctrl_key);
    let shifted = Mods {
        shift: true,
        ..SUPER
    };
    assert_eq!(locked(&["z", "Z"], shifted), ctrl_key);
    assert!(matches!(locked(&["BackSpace"], SUPER), Some(Action::Tap(c)) if c.len() == 2));
    // Any other ❖ chord does nothing there: no "q" typed into the password.
    assert_eq!(locked(&["q"], SUPER), Some(Action::Swallow));
    // Plain keys, and the keys the other rules bind, reach the field as they are.
    assert_eq!(locked(&["a"], Mods::default()), None);
    assert_eq!(locked(&["XF86AudioMute"], Mods::default()), None);
    // The other rules are untouched by the locked ones.
    assert_eq!(
        action(&map, &["a"], SUPER, "dev.dashi.settings"),
        Some(Action::Bind("app-chord".into()))
    );
    // A keymap without `locked` has none: keys go to the lock screen as they are.
    let plain = parse(json!({ "rules": [] }).as_object().unwrap()).unwrap();
    let names = vec!["a".to_string()];
    let pressed = Pressed {
        names: &names,
        mods: SUPER,
        app_id: "",
    };
    assert_eq!(plain.action_while_locked(&pressed), None);
}

#[test]
fn a_locked_rule_never_binds_and_names_no_app() {
    let refused = |locked: Value| {
        parse(
            json!({ "apps": { "metal": ["dev.dashi.*"] }, "rules": [], "locked": locked })
                .as_object()
                .unwrap(),
        )
        .unwrap_err()
    };
    let bind = refused(json!([
        { "when": "super+a", "send": "ctrl+a" },
        { "when": "super+q", "bind": "quit-app" }
    ]));
    assert!(bind.starts_with("locked 1:"), "{bind}");
    let app = refused(json!([{ "when": "super+a", "app": "metal", "send": "ctrl+a" }]));
    assert!(app.starts_with("locked 0:"), "{app}");
    let not_a_list = refused(json!({}));
    assert!(not_a_list.starts_with("`locked`"), "{not_a_list}");
    assert!(refused(json!([{ "when": "super+a" }])).starts_with("locked 0:"));
}
