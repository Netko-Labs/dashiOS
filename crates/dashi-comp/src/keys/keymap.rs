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
//! A `bind` rule with `armsAfterTap: true` switches to them too, the moment
//! its key is pressed (❖Space opens the launcher as a tap does): keys queued
//! behind it, while the compositor was busy, are matched by them at once.
//!
//! `locked` is the list matched while the screen is locked, for the lock
//! screen's field (❖A as Ctrl+A, say); none of the other rules apply then. A
//! locked rule may `send`, `tap`, or `swallow`, never `bind` (no shell binding
//! fires while locked), and names no `app` (the lock screen is no app's). A key
//! no locked rule matches reaches the lock screen as it is.

use std::collections::HashMap;

mod chord;
mod rules;
#[cfg(test)]
mod tests;

pub(crate) use chord::{Chord, KeyRef, Mods};
pub(crate) use rules::{Action, KeymapParams};
use rules::{KeyMatch, Rule, RuleParams, parse_rule};

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
    pub(crate) fn parse(params: &KeymapParams) -> Result<Self, String> {
        let apps = &params.apps;
        let list = |each: &str, rules: &[RuleParams]| {
            rules
                .iter()
                .enumerate()
                .map(|(index, rule)| {
                    parse_rule(rule, apps).map_err(|error| format!("{each} {index}: {error}"))
                })
                .collect::<Result<Vec<_>, _>>()
        };
        let rules = list("rule", &params.rules)?;
        let after_tap = params
            .after_tap
            .as_deref()
            .map(|rules| list("afterTap", rules))
            .transpose()?;
        let locked = list("locked", &params.locked)?;
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
            apps: apps.clone(),
            tap_ms: params.tap_ms.map_or(350, |ms| ms.to::<u64>()),
            hold_ms: params.hold_ms.map_or(800, |ms| ms.to::<u64>()),
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
    #[cfg(test)]
    pub(crate) fn action_for(&self, pressed: &Pressed<'_>) -> Option<&Action> {
        self.matched(pressed).map(|(action, _)| action)
    }

    /// The first rule that matches: its action, and whether it arms the `afterTap` rules.
    pub(crate) fn matched(&self, pressed: &Pressed<'_>) -> Option<(&Action, bool)> {
        self.rules
            .iter()
            .find(|rule| self.matches(rule, pressed))
            .map(|rule| (&rule.action, rule.arms_after_tap))
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
