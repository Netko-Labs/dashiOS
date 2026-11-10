//! A keymap's rules: `keymap`'s params as the shell sends them, and the
//! rules parsed from them.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::chord::{Chord, Mods, set_mod};
use crate::ipc::protocol::Millis;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum KeyMatch {
    Names(Vec<String>),
    Letter,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct When {
    pub(super) super_: bool,
    pub(super) ctrl: bool,
    pub(super) alt: bool,
    /// Only checked when the rule names it.
    pub(super) shift: Option<bool>,
    pub(super) key: KeyMatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Action {
    Bind(String),
    Send(Chord),
    Tap(Vec<Chord>),
    Swallow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Rule {
    pub(super) when: When,
    pub(super) app: Option<String>,
    pub(super) action: Action,
    /// A `bind` that switches to the `afterTap` rules as a ❖ tap does (`armsAfterTap`).
    pub(super) arms_after_tap: bool,
}

/// `keymap`'s params: the bindings (docs/compositor-ipc.md; the shell's
/// src/keymap.ts `Keymap`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KeymapParams {
    #[serde(default)]
    pub apps: HashMap<String, Vec<String>>,
    pub tap_ms: Option<Millis<10_000>>,
    pub hold_ms: Option<Millis<10_000>>,
    pub rules: Vec<RuleParams>,
    pub after_tap: Option<Vec<RuleParams>>,
    #[serde(default)]
    pub locked: Vec<RuleParams>,
}

/// One rule: `when` a chord matches (in `app`'s windows), `bind`, `send`,
/// `tap` or `swallow` (the first given wins).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuleParams {
    pub when: String,
    pub app: Option<String>,
    pub bind: Option<String>,
    pub send: Option<String>,
    pub tap: Option<Vec<String>>,
    pub swallow: Option<bool>,
    pub arms_after_tap: Option<bool>,
}

pub(super) fn parse_rule(
    rule: &RuleParams,
    apps: &HashMap<String, Vec<String>>,
) -> Result<Rule, String> {
    let when = parse_when(&rule.when)?;
    let app = match &rule.app {
        None => None,
        Some(class) if apps.contains_key(class) => Some(class.clone()),
        Some(_) => return Err("app must name a class in apps".into()),
    };
    let action = if let Some(name) = &rule.bind {
        if name.is_empty() {
            return Err("bind must be a name".into());
        }
        Action::Bind(name.clone())
    } else if let Some(chord) = &rule.send {
        Action::Send(Chord::parse(chord)?)
    } else if let Some(chords) = &rule.tap {
        Action::Tap(
            chords
                .iter()
                .map(|chord| Chord::parse(chord))
                .collect::<Result<_, _>>()?,
        )
    } else if rule.swallow == Some(true) {
        Action::Swallow
    } else {
        return Err("a rule needs bind, send, tap, or swallow".into());
    };
    let arms_after_tap = match rule.arms_after_tap {
        None | Some(false) => false,
        Some(true) if matches!(action, Action::Bind(_)) => true,
        Some(true) => return Err("only a bind rule arms afterTap".into()),
    };
    Ok(Rule {
        when,
        app,
        action,
        arms_after_tap,
    })
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
