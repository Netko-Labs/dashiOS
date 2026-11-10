//! Every IPC method, once: its name, who may ask it, and what runs
//! (docs/compositor-ipc.md, "Who may ask"). A method not here is unknown; a
//! caller not allowed is refused before anything is read or changed.

use serde_json::{Value, json};

use super::{
    methods::{agents, capture, chrome, screens, spaces, windows},
    params::Params,
    server::ConnectionId,
};
use crate::state::Dashi;

/// Who may ask a method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Who {
    /// The shell only: the session client, and the processes it started as
    /// part of itself (session/trust.rs).
    Shell,
    /// The shell, and a process it granted this method to (`ipc-clients`).
    Granted,
    /// Any process that reaches the socket (it is the user's, mode 0600).
    Anyone,
}

impl Who {
    /// The word for it in docs/compositor-ipc.md.
    #[cfg(test)]
    pub(crate) fn word(self) -> &'static str {
        match self {
            Who::Shell => "shell",
            Who::Granted => "granted",
            Who::Anyone => "anyone",
        }
    }
}

/// One request as a method sees it.
pub(crate) struct Ask {
    pub connection: ConnectionId,
    pub id: u64,
    pub params: Params,
}

/// What runs for a method.
#[derive(Clone, Copy)]
pub(crate) enum Run {
    /// Answers at once.
    Now(fn(&mut Dashi, &Ask) -> Result<Value, String>),
    /// Answers later, itself, once its work is done off the event loop; an
    /// error now is answered now.
    Later(fn(&mut Dashi, &Ask) -> Result<(), String>),
}

pub(crate) struct Method {
    pub name: &'static str,
    pub who: Who,
    pub run: Run,
}

const fn shell(name: &'static str, run: fn(&mut Dashi, &Ask) -> Result<Value, String>) -> Method {
    Method {
        name,
        who: Who::Shell,
        run: Run::Now(run),
    }
}

const fn granted(name: &'static str, run: fn(&mut Dashi, &Ask) -> Result<Value, String>) -> Method {
    Method {
        name,
        who: Who::Granted,
        run: Run::Now(run),
    }
}

const fn anyone(name: &'static str, run: fn(&mut Dashi, &Ask) -> Result<Value, String>) -> Method {
    Method {
        name,
        who: Who::Anyone,
        run: Run::Now(run),
    }
}

/// The protocol. Reading the screens is anyone's; acting on windows and
/// screens as a person could by hand can be granted; everything that hears
/// or steers input, reads pixels, or decides for the shell is the shell's.
#[rustfmt::skip]
pub(crate) const METHODS: &[Method] = &[
    // Session and windows
    shell("subscribe", windows::subscribe),
    anyone("session", windows::session),
    granted("windows", windows::windows),
    granted("focus", windows::focus),
    granted("close", windows::close),
    granted("minimize", windows::minimize),
    granted("hide", windows::hide),
    shell("suspend", windows::suspend),
    granted("frame", windows::frame),
    shell("place", windows::place),
    granted("fullscreen", windows::fullscreen),
    shell("send-keys", windows::send_keys),
    shell("animation-target", windows::animation_target),
    shell("layer-motion", windows::layer_motion),
    granted("window-for-handle", windows::window_for_handle),
    shell("attach", windows::attach),
    // Screens
    anyone("outputs", screens::outputs),
    shell("mirror", screens::mirror),
    granted("output", screens::output),
    shell("xwayland-scale", screens::xwayland_scale),
    shell("cursor-size", screens::cursor_size),
    shell("input-region", screens::input_region),
    granted("outputs-config", screens::outputs_config),
    shell("power", screens::power),
    shell("gamma", screens::gamma),
    anyone("gpus", screens::gpus),
    shell("gpu-keep", screens::gpu_keep),
    shell("wallpaper", screens::wallpaper),
    // Shell chrome and input claims
    shell("chrome", chrome::chrome),
    shell("window-style", chrome::window_style),
    shell("keymap", chrome::keymap),
    shell("bars", chrome::bars),
    shell("edges", chrome::edges),
    shell("layout", chrome::layout),
    shell("gestures", chrome::gestures),
    shell("idle", chrome::idle),
    shell("keyboard", chrome::keyboard),
    shell("input", chrome::input),
    // Spaces and overview
    shell("spaces", spaces::spaces),
    shell("space-add", spaces::space_add),
    shell("space-remove", spaces::space_remove),
    granted("space-switch", spaces::space_switch),
    granted("space-move", spaces::space_move),
    shell("overview", spaces::overview),
    // Live pictures
    shell("space-previews", spaces::space_previews),
    shell("window-thumbnails", spaces::window_thumbnails),
    // Capture and agents
    Method { name: "capture", who: Who::Shell, run: Run::Later(capture::capture) },
    shell("screencopy-clients", agents::screencopy_clients),
    shell("applet-clients", agents::applet_clients),
    shell("ipc-clients", agents::ipc_clients),
    shell("agent-input", agents::agent_input),
    // Secrets for agents
    shell("capture-mask", agents::capture_mask),
    shell("input-origin", agents::input_origin),
    // Clipboard history and snippets
    shell("snippets", agents::snippets),
    shell("snippet-erase", agents::snippet_erase),
];

/// The method called `name`.
pub(crate) fn find(name: &str) -> Option<&'static Method> {
    METHODS.iter().find(|method| method.name == name)
}

/// `{}` once done, else the reason.
pub(crate) fn done(result: Result<(), String>) -> Result<Value, String> {
    result.map(|()| json!({}))
}

/// Why a caller was refused a method that is `who`'s (never `Anyone`'s).
pub(crate) fn refusal(name: &str, who: Who) -> String {
    match who {
        Who::Granted => format!("{name} is only for the shell and what it grants it to"),
        Who::Shell | Who::Anyone => format!("{name} is only for the shell"),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};

    use super::*;

    /// docs/compositor-ipc.md's request tables: method → the "Who" column.
    fn documented() -> BTreeMap<String, String> {
        let doc = include_str!("../../../../docs/compositor-ipc.md");
        let requests = doc
            .split("\n## Requests\n")
            .nth(1)
            .and_then(|rest| rest.split("\n## ").next())
            .expect("docs/compositor-ipc.md has a Requests section");
        let mut methods = BTreeMap::new();
        for line in requests.lines() {
            let cells: Vec<&str> = line.split(" | ").map(str::trim).collect();
            let Some(name) = cells
                .first()
                .and_then(|c| c.strip_prefix("| `"))
                .and_then(|c| c.strip_suffix('`'))
            else {
                continue;
            };
            let who = cells.get(1).copied().unwrap_or_default().to_owned();
            assert!(
                methods.insert(name.to_owned(), who).is_none(),
                "{name} is documented twice"
            );
        }
        methods
    }

    #[test]
    fn every_method_is_named_once() {
        let mut seen = BTreeSet::new();
        for method in METHODS {
            assert!(
                seen.insert(method.name),
                "{} is in the table twice",
                method.name
            );
        }
        assert!(find("subscribe").is_some());
        assert!(find("frobnicate").is_none());
    }

    #[test]
    fn the_table_and_the_doc_agree() {
        let documented = documented();
        for method in METHODS {
            let who = documented
                .get(method.name)
                .unwrap_or_else(|| panic!("{} is not in docs/compositor-ipc.md", method.name));
            assert_eq!(
                who,
                method.who.word(),
                "docs/compositor-ipc.md says {who} for {}, the table {}",
                method.name,
                method.who.word()
            );
        }
        for name in documented.keys() {
            assert!(
                find(name).is_some(),
                "{name} is documented but not in the table"
            );
        }
    }

    #[test]
    fn privileged_methods_are_the_shells() {
        // What the rulebook says no one else may decide or see.
        for name in [
            "subscribe",
            "keymap",
            "send-keys",
            "agent-input",
            "capture",
            "capture-mask",
            "input-origin",
            "screencopy-clients",
            "applet-clients",
            "ipc-clients",
            "snippets",
            "snippet-erase",
            "gamma",
        ] {
            assert_eq!(find(name).map(|m| m.who), Some(Who::Shell), "{name}");
        }
    }
}
