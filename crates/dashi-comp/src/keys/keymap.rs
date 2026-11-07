//! The shell's keymap (packages/shell/src/keymap.ts), parsed and matched.
//!
//! A rule's `when` is modifiers (super, ctrl, alt, shift) and a key: an xkb
//! keysym name ("q", "Left", "Tab|ISO_Left_Tab"), `letter` (a–z), or `*`.
//! Super, Ctrl, and Alt must match exactly; Shift only when named. The first
//! matching rule wins; its action is `bind`, `send`, `tap`, or `swallow`.
//!
//! `afterTap` is a second list of rules the compositor switches to by itself
//! the moment ❖ is tapped, until the shell's next keymap: the shell's launcher
//! takes the keys typed after the tap from that instant, not from whenever the
//! shell hears of it. Which rules, and whether there are any, is the shell's.
//!
//! `locked` is the list matched while the screen is locked, for the lock
//! screen's field (❖A as Ctrl+A, say); none of the other rules apply then. A
//! locked rule may `send`, `tap`, or `swallow`, never `bind` (no shell binding
//! fires while locked), and names no `app` (the lock screen is no app's). A key
//! no locked rule matches reaches the lock screen as it is.

use std::collections::HashMap;

use serde_json::{Map, Value};

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

fn set_mod(mods: &mut Mods, name: &str) -> Option<()> {
    match name {
        "super" => mods.super_ = true,
        "ctrl" => mods.ctrl = true,
        "alt" => mods.alt = true,
        "shift" => mods.shift = true,
        _ => return None,
    }
    Some(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum KeyMatch {
    Names(Vec<String>),
    Letter,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct When {
    super_: bool,
    ctrl: bool,
    alt: bool,
    /// Only checked when the rule names it.
    shift: Option<bool>,
    key: KeyMatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Action {
    Bind(String),
    Send(Chord),
    Tap(Vec<Chord>),
    Swallow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Rule {
    when: When,
    app: Option<String>,
    action: Action,
}

/// A key as pressed: its keysym names (unshifted first, then as typed).
pub(crate) struct Pressed<'a> {
    pub names: &'a [String],
    pub mods: Mods,
    /// The focused window's app id ("" for none or a shell surface).
    pub app_id: &'a str,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Keymap {
    apps: HashMap<String, Vec<String>>,
    pub tap_ms: u64,
    pub hold_ms: u64,
    rules: Vec<Rule>,
    /// The rules for after the next ❖ tap (`afterTap`), once.
    after_tap: Option<Vec<Rule>>,
    /// The rules while the screen is locked (`locked`).
    locked: Vec<Rule>,
}

impl Default for Keymap {
    /// Before the shell sends one: no rules, Mac-like ❖ timings.
    fn default() -> Self {
        Self {
            apps: HashMap::new(),
            tap_ms: 350,
            hold_ms: 800,
            rules: Vec::new(),
            after_tap: None,
            locked: Vec::new(),
        }
    }
}

impl Keymap {
    pub(crate) fn parse(params: &Map<String, Value>) -> Result<Self, String> {
        let apps = match params.get("apps") {
            None => HashMap::new(),
            Some(Value::Object(apps)) => apps
                .iter()
                .map(|(class, patterns)| {
                    let patterns = patterns
                        .as_array()
                        .ok_or_else(|| format!("apps.{class} must be a list"))?
                        .iter()
                        .map(|p| {
                            p.as_str()
                                .map(str::to_owned)
                                .ok_or_else(|| format!("apps.{class} must list strings"))
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok((class.clone(), patterns))
                })
                .collect::<Result<_, String>>()?,
            Some(_) => return Err("apps must be an object".into()),
        };
        let millis = |key: &str, default: u64| match params.get(key) {
            None => Ok(default),
            Some(v) => v
                .as_u64()
                .filter(|ms| *ms <= 10_000)
                .ok_or_else(|| format!("{key} must be milliseconds")),
        };
        // `name` for the list, `each` for a rule in it ("rules", "rule 3: …").
        let list = |name: &str, each: &str, rules: &Value| {
            rules
                .as_array()
                .ok_or_else(|| format!("{name} must be a list"))?
                .iter()
                .enumerate()
                .map(|(index, rule)| {
                    parse_rule(rule, &apps).map_err(|error| format!("{each} {index}: {error}"))
                })
                .collect::<Result<Vec<_>, _>>()
        };
        let rules = list(
            "rules",
            "rule",
            params.get("rules").ok_or("rules must be a list")?,
        )?;
        let after_tap = params
            .get("afterTap")
            .map(|rules| list("afterTap", "afterTap", rules))
            .transpose()?;
        let locked = match params.get("locked") {
            None => Vec::new(),
            Some(rules) => list("locked", "locked", rules)?,
        };
        if let Some(index) = locked
            .iter()
            .position(|rule| matches!(rule.action, Action::Bind(_)))
        {
            return Err(format!(
                "locked {index}: no shell binding fires while locked; send, tap, or swallow"
            ));
        }
        if let Some(index) = locked.iter().position(|rule| rule.app.is_some()) {
            return Err(format!("locked {index}: the lock screen is no app's"));
        }
        Ok(Self {
            apps,
            tap_ms: millis("tapMs", 350)?,
            hold_ms: millis("holdMs", 800)?,
            rules,
            after_tap,
            locked,
        })
    }

    /// ❖ was tapped: the `afterTap` rules, if the keymap has them, are the rules from now
    /// on (once; the shell's next keymap replaces them). Whether it switched.
    pub(crate) fn arm_after_tap(&mut self) -> bool {
        match self.after_tap.take() {
            Some(rules) => {
                self.rules = rules;
                true
            }
            None => false,
        }
    }

    /// The first rule that matches, if any.
    pub(crate) fn action_for(&self, pressed: &Pressed<'_>) -> Option<&Action> {
        self.rules
            .iter()
            .find(|rule| self.matches(rule, pressed))
            .map(|rule| &rule.action)
    }

    /// While locked: the first `locked` rule that matches, if any (never a `bind`).
    pub(crate) fn action_while_locked(&self, pressed: &Pressed<'_>) -> Option<&Action> {
        self.locked
            .iter()
            .find(|rule| self.matches(rule, pressed))
            .map(|rule| &rule.action)
    }

    fn matches(&self, rule: &Rule, pressed: &Pressed<'_>) -> bool {
        let when = &rule.when;
        let mods = pressed.mods;
        if when.super_ != mods.super_ || when.ctrl != mods.ctrl || when.alt != mods.alt {
            return false;
        }
        if when.shift.is_some_and(|shift| shift != mods.shift) {
            return false;
        }
        let key = match &when.key {
            KeyMatch::Any => true,
            KeyMatch::Letter => pressed
                .names
                .first()
                .is_some_and(|name| name.len() == 1 && name.as_bytes()[0].is_ascii_lowercase()),
            KeyMatch::Names(names) => names.iter().any(|name| pressed.names.contains(name)),
        };
        key && rule
            .app
            .as_ref()
            .is_none_or(|class| self.in_class(class, pressed.app_id))
    }

    fn in_class(&self, class: &str, app_id: &str) -> bool {
        self.apps.get(class).is_some_and(|patterns| {
            patterns
                .iter()
                .any(|pattern| match pattern.strip_suffix('*') {
                    Some(prefix) => app_id.starts_with(prefix),
                    None => pattern == app_id,
                })
        })
    }
}

fn parse_rule(rule: &Value, apps: &HashMap<String, Vec<String>>) -> Result<Rule, String> {
    let rule = rule.as_object().ok_or("a rule is an object")?;
    let when = parse_when(
        rule.get("when")
            .and_then(Value::as_str)
            .ok_or("when is required")?,
    )?;
    let app = match rule.get("app") {
        None => None,
        Some(Value::String(class)) if apps.contains_key(class) => Some(class.clone()),
        Some(_) => return Err("app must name a class in apps".into()),
    };
    let action = if let Some(name) = rule.get("bind") {
        Action::Bind(
            name.as_str()
                .filter(|n| !n.is_empty())
                .ok_or("bind must be a name")?
                .to_owned(),
        )
    } else if let Some(chord) = rule.get("send") {
        Action::Send(Chord::parse(chord.as_str().ok_or("send must be a chord")?)?)
    } else if let Some(chords) = rule.get("tap") {
        let chords = chords.as_array().ok_or("tap must be a list of chords")?;
        Action::Tap(
            chords
                .iter()
                .map(|c| {
                    c.as_str()
                        .ok_or_else(|| "tap must list chords".to_string())
                        .and_then(Chord::parse)
                })
                .collect::<Result<_, _>>()?,
        )
    } else if rule.get("swallow") == Some(&Value::Bool(true)) {
        Action::Swallow
    } else {
        return Err("a rule needs bind, send, tap, or swallow".into());
    };
    Ok(Rule { when, app, action })
}

fn parse_when(text: &str) -> Result<When, String> {
    let mut parts: Vec<&str> = text.split('+').collect();
    let key = parts
        .pop()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| format!("{text:?} has no key"))?;
    let mut mods = Mods::default();
    let mut shift_named = false;
    for part in parts {
        set_mod(&mut mods, part).ok_or_else(|| format!("{text:?}: unknown modifier {part:?}"))?;
        shift_named |= part == "shift";
    }
    let key = match key {
        "*" => KeyMatch::Any,
        "letter" => KeyMatch::Letter,
        names => KeyMatch::Names(names.split('|').map(str::to_owned).collect()),
    };
    Ok(When {
        super_: mods.super_,
        ctrl: mods.ctrl,
        alt: mods.alt,
        shift: shift_named.then_some(true),
        key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn keymap() -> Keymap {
        let params = json!({
            "apps": { "terminal": ["foot"], "metal": ["", "dev.dashi.*"] },
            "tapMs": 300,
            "rules": [
                { "when": "XF86AudioMute", "bind": "volume-mute" },
                { "when": "super+shift+3", "bind": "screenshot-screen" },
                { "when": "super+ctrl+*", "swallow": true },
                { "when": "super+q", "bind": "quit-app" },
                { "when": "super+shift+Tab|ISO_Left_Tab", "bind": "switch-previous" },
                { "when": "super+Tab|ISO_Left_Tab", "bind": "switch-next" },
                { "when": "super+Left", "send": "Home" },
                { "when": "super+BackSpace", "app": "terminal", "tap": ["ctrl+u"] },
                { "when": "super+BackSpace", "tap": ["shift+Home", "BackSpace"] },
                { "when": "super+*", "app": "metal", "bind": "app-chord" },
                { "when": "super+letter", "app": "terminal", "send": "ctrl+shift+key" },
                { "when": "super+*", "send": "ctrl+key" }
            ]
        });
        Keymap::parse(params.as_object().unwrap()).unwrap()
    }

    fn action(map: &Keymap, names: &[&str], mods: Mods, app_id: &str) -> Option<Action> {
        let names: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        map.action_for(&Pressed {
            names: &names,
            mods,
            app_id,
        })
        .cloned()
    }

    const SUPER: Mods = Mods {
        super_: true,
        ctrl: false,
        alt: false,
        shift: false,
    };

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
        let bad = |rules: Value| {
            Keymap::parse(json!({ "rules": rules }).as_object().unwrap()).unwrap_err()
        };
        assert!(bad(json!([{ "when": "super+q" }])).starts_with("rule 0:"));
        assert!(bad(json!([{ "when": "meta+q", "bind": "x" }])).contains("meta"));
        assert!(bad(json!([{ "when": "q", "app": "nope", "bind": "x" }])).contains("class"));
        assert!(Keymap::parse(json!({}).as_object().unwrap()).is_err());
        let after = Keymap::parse(
            json!({ "rules": [], "afterTap": [{ "when": "q" }] })
                .as_object()
                .unwrap(),
        )
        .unwrap_err();
        assert!(after.starts_with("afterTap 0:"), "{after}");
        assert!(
            Keymap::parse(json!({ "rules": [], "afterTap": {} }).as_object().unwrap()).is_err()
        );
    }

    #[test]
    fn while_locked_only_the_locked_rules_apply_and_none_binds() {
        let map = Keymap::parse(
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
        let plain = Keymap::parse(json!({ "rules": [] }).as_object().unwrap()).unwrap();
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
            Keymap::parse(
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
        assert!(refused(json!({})).contains("locked must be a list"));
        assert!(refused(json!([{ "when": "super+a" }])).starts_with("locked 0:"));
    }

    #[test]
    fn after_a_tap_the_after_tap_rules_hold_until_the_next_keymap() {
        let mut map = Keymap::parse(
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
        let mut none = Keymap::parse(json!({ "rules": [] }).as_object().unwrap()).unwrap();
        assert!(!none.arm_after_tap());
    }
}
