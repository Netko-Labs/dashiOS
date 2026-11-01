//! What the shell configures the compositor with: its keymap, title bar
//! style, drag-to-tile zones, edge claims, gestures, idle timeouts, Dock tile
//! targets, screencopy grants. Each request's latest params are kept here as
//! the shell sent them; the compositor acts on each in its milestone
//! (docs/compositor.md), parsing it then. Until then the shell is told yes, so
//! it starts as it would on a compositor that has the feature off.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// The requests whose params are kept, and the milestone that acts on them.
pub(crate) const KEPT: &[(&str, &str)] = &[
    ("keymap", "C1"),
    ("chrome", "C1"),
    ("layout", "C2"),
    ("bars", "C2"),
    ("edges", "C2"),
    ("gestures", "C2"),
    ("idle", "C2"),
    ("animation-target", "C2"),
    ("screencopy-clients", "C3"),
];

#[derive(Default)]
pub(crate) struct ShellConfig {
    kept: HashMap<&'static str, Map<String, Value>>,
}

impl ShellConfig {
    /// Keep `params` for `method`; false when `method` is not one that is kept.
    pub(crate) fn keep(&mut self, method: &str, params: Map<String, Value>) -> bool {
        let Some((name, milestone)) = KEPT.iter().find(|(name, _)| *name == method) else {
            return false;
        };
        tracing::debug!(
            method,
            milestone,
            "kept the shell's configuration; not acted on yet"
        );
        self.kept.insert(name, params);
        true
    }

    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "read by the milestones that act on it, keymap first"
        )
    )]
    pub(crate) fn get(&self, method: &str) -> Option<&Map<String, Value>> {
        self.kept.get(method)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_the_listed_requests_are_kept_and_the_latest_wins() {
        let mut config = ShellConfig::default();
        let first = json!({ "zones": [] }).as_object().cloned().unwrap();
        let second = json!({ "zones": [1] }).as_object().cloned().unwrap();
        assert!(config.keep("layout", first));
        assert!(config.keep("layout", second.clone()));
        assert_eq!(config.get("layout"), Some(&second));
        assert!(!config.keep("focus", Map::new()));
        assert_eq!(config.get("focus"), None);
    }
}
