//! Every IPC method, once: its name, who may ask it, and what runs
//! (docs/compositor-ipc.md, "Who may ask"). A method not here is unknown; a
//! caller not allowed is refused before anything is read or changed.

use serde_json::Value;

use super::{
    methods::{agents, capture, chrome, screens, spaces, windows},
    protocol::{Done, read, write},
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

/// One request as a method sees it (its params are its own argument, typed).
pub(crate) struct Ask {
    pub connection: ConnectionId,
    pub id: u64,
}

/// A method's raw runner: the params as they came, the reply as it goes.
pub(crate) type Raw<T> = fn(&mut Dashi, &Ask, Value) -> Result<T, String>;

/// What runs for a method.
#[derive(Clone, Copy)]
pub(crate) enum Run {
    /// Answers at once.
    Now(Raw<Value>),
    /// Answers later, itself, once its work is done off the event loop; an
    /// error now is answered now.
    Later(Raw<()>),
}

pub(crate) struct Method {
    pub name: &'static str,
    pub who: Who,
    pub run: Run,
}

/// A method run as `fn(&mut Dashi, &Ask, Params) -> Result<Reply, String>`:
/// its params are read into their type (unknown fields refused) and its reply
/// written from one (docs/compositor-ipc.md has both).
macro_rules! typed {
    ($run:path) => {{
        fn run(state: &mut Dashi, ask: &Ask, params: Value) -> Result<Value, String> {
            write(&$run(state, ask, read(params)?)?)
        }
        run
    }};
}

/// As `typed!`, for a method that answers later itself.
macro_rules! later {
    ($run:path) => {{
        fn run(state: &mut Dashi, ask: &Ask, params: Value) -> Result<(), String> {
            $run(state, ask, read(params)?)
        }
        Run::Later(run)
    }};
}

const fn shell(name: &'static str, run: Raw<Value>) -> Method {
    Method {
        name,
        who: Who::Shell,
        run: Run::Now(run),
    }
}

const fn granted(name: &'static str, run: Raw<Value>) -> Method {
    Method {
        name,
        who: Who::Granted,
        run: Run::Now(run),
    }
}

const fn anyone(name: &'static str, run: Raw<Value>) -> Method {
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
    shell("subscribe", typed!(windows::subscribe)),
    anyone("session", typed!(windows::session)),
    granted("windows", typed!(windows::windows)),
    granted("focus", typed!(windows::focus)),
    granted("close", typed!(windows::close)),
    granted("minimize", typed!(windows::minimize)),
    granted("hide", typed!(windows::hide)),
    shell("suspend", typed!(windows::suspend)),
    granted("frame", typed!(windows::frame)),
    shell("place", typed!(windows::place)),
    granted("fullscreen", typed!(windows::fullscreen)),
    shell("send-keys", typed!(windows::send_keys)),
    shell("animation-target", typed!(windows::animation_target)),
    shell("layer-motion", typed!(windows::layer_motion)),
    granted("window-for-handle", typed!(windows::window_for_handle)),
    shell("attach", typed!(windows::attach)),
    // Screens
    anyone("outputs", typed!(screens::outputs)),
    shell("mirror", typed!(screens::mirror)),
    granted("output", typed!(screens::output)),
    shell("xwayland-scale", typed!(screens::xwayland_scale)),
    shell("cursor-size", typed!(screens::cursor_size)),
    shell("input-region", typed!(screens::input_region)),
    granted("outputs-config", typed!(screens::outputs_config)),
    shell("power", typed!(screens::power)),
    shell("gamma", typed!(screens::gamma)),
    anyone("gpus", typed!(screens::gpus)),
    shell("gpu-keep", typed!(screens::gpu_keep)),
    shell("wallpaper", typed!(screens::wallpaper)),
    // Shell chrome and input claims
    shell("chrome", typed!(chrome::chrome)),
    shell("window-style", typed!(chrome::window_style)),
    shell("keymap", typed!(chrome::keymap)),
    shell("held-keys", typed!(chrome::held_keys)),
    shell("bars", typed!(chrome::bars)),
    shell("edges", typed!(chrome::edges)),
    shell("layout", typed!(chrome::layout)),
    shell("gestures", typed!(chrome::gestures)),
    shell("idle", typed!(chrome::idle)),
    shell("keyboard", typed!(chrome::keyboard)),
    shell("input", typed!(chrome::input)),
    // Spaces and overview
    shell("spaces", typed!(spaces::spaces)),
    shell("space-add", typed!(spaces::space_add)),
    shell("space-remove", typed!(spaces::space_remove)),
    granted("space-switch", typed!(spaces::space_switch)),
    granted("space-move", typed!(spaces::space_move)),
    shell("overview", typed!(spaces::overview)),
    // Live pictures
    shell("space-previews", typed!(spaces::space_previews)),
    shell("window-thumbnails", typed!(spaces::window_thumbnails)),
    // Capture and agents
    Method { name: "capture", who: Who::Shell, run: later!(capture::capture) },
    shell("screencopy-clients", typed!(agents::screencopy_clients)),
    shell("applet-clients", typed!(agents::applet_clients)),
    shell("ipc-clients", typed!(agents::ipc_clients)),
    shell("agent-input", typed!(agents::agent_input)),
    // Secrets for agents
    shell("capture-mask", typed!(agents::capture_mask)),
    shell("input-origin", typed!(agents::input_origin)),
    // Clipboard history and snippets
    shell("snippets", typed!(agents::snippets)),
    shell("snippet-erase", typed!(agents::snippet_erase)),
];

/// The method called `name`.
pub(crate) fn find(name: &str) -> Option<&'static Method> {
    METHODS.iter().find(|method| method.name == name)
}

/// `{}` once done, else the reason.
pub(crate) fn done(result: Result<(), String>) -> Result<Done, String> {
    result.map(|()| Done {})
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
            "held-keys",
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
