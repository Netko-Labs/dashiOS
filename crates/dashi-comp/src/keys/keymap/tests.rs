//! The keymap's tests, by behaviour, and the fixtures they share.

use super::*;
use serde_json::{Map, Value, json};

mod after_tap;
mod locked;
mod matching;

fn parse(params: &Map<String, Value>) -> Result<Keymap, String> {
    Keymap::parse(&crate::ipc::protocol::read(Value::Object(params.clone()))?)
}

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
    parse(params.as_object().unwrap()).unwrap()
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
