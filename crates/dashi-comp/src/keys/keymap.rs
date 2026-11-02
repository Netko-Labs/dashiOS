//! The shell's keymap (packages/shell/src/keymap.ts), parsed and matched.
//!
//! A rule's `when` is modifiers (super, ctrl, alt, shift) and a key: an xkb
//! keysym name ("q", "Left", "Tab|ISO_Left_Tab"), `letter` (a–z), or `*`.
//! Super, Ctrl, and Alt must match exactly; Shift only when named. The first
//! matching rule wins; its action is `bind`, `send`, `tap`, or `swallow`.

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
}

impl Default for Keymap {
    /// Before the shell sends one: no rules, Mac-like ❖ timings.
    fn default() -> Self {
        Self {
            apps: HashMap::new(),
            tap_ms: 350,
            hold_ms: 800,
            rules: Vec::new(),
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
        let rules = params
            .get("rules")
            .and_then(Value::as_array)
            .ok_or("rules must be a list")?
            .iter()
            .enumerate()
            .map(|(index, rule)| {
                parse_rule(rule, &apps).map_err(|error| format!("rule {index}: {error}"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            apps,
            tap_ms: millis("tapMs", 350)?,
            hold_ms: millis("holdMs", 800)?,
            rules,
        })
    }

    /// The first rule that matches, if any.
    pub(crate) fn action_for(&self, pressed: &Pressed<'_>) -> Option<&Action> {
        self.rules
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
    }
}
