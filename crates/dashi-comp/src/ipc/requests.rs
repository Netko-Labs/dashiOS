//! What the shell may ask (docs/compositor-ipc.md, "Requests"). C0 answers
//! `subscribe`, `session`, and `windows`; the rest arrive with their milestones
//! (docs/compositor.md) and until then say so.

use serde_json::{Value, json};

use super::{frame::Request, server::ConnectionId};
use crate::state::Dashi;

/// Methods the protocol has that this compositor does not do yet.
const LATER: &[&str] = &[
    "focus",
    "close",
    "minimize",
    "hide",
    "restore",
    "frame",
    "place",
    "fullscreen",
    "send-keys",
    "animation-target",
    "outputs",
    "output",
    "outputs-config",
    "power",
    "gamma",
    "wallpaper",
    "chrome",
    "keymap",
    "bars",
    "edges",
    "layout",
    "gestures",
    "idle",
    "spaces",
    "space-add",
    "space-switch",
    "space-move",
    "overview",
    "capture",
    "screencopy-clients",
    "agent-input",
];

pub(crate) fn handle(
    state: &mut Dashi,
    connection: ConnectionId,
    request: Request,
) -> Result<Value, String> {
    match request.method.as_str() {
        "subscribe" => {
            state.ipc.subscribe(connection);
            Ok(json!({}))
        }
        "session" => Ok(session(state)),
        "windows" => Ok(json!({ "windows": state.windows.describe_all(state) })),
        method if LATER.contains(&method) => Err(format!("{method}: not in this dashi-comp yet")),
        method => Err(format!("unknown method: {method}")),
    }
}

fn session(state: &Dashi) -> Value {
    let pointer = state.seat.get_pointer().map(|pointer| {
        let at = pointer.current_location();
        json!({ "x": at.x, "y": at.y })
    });
    json!({
        "waylandDisplay": state.socket_name.to_string_lossy(),
        "display": null,
        "xwayland": "off",
        "pointer": pointer,
    })
}
