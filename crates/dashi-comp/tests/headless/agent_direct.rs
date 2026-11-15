//! An agent's hands on the Space that shows, without the person's seat (session/agent_direct.rs).

use serde_json::json;

use super::fixtures::wait_event;
use crate::support::{client::Client, compositor::Compositor};

/// On the Space that shows, a click and typing into a window that hears one seat reach its app
/// with the seat left alone: no wait for the person, their pointer and keyboard where they were.
/// A drag still needs the seat, and waits for them.
#[test]
fn an_agent_clicks_and_types_on_screen_without_the_persons_seat() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let session = ipc.request("session", json!({}))["result"].clone();
    let display = session["waylandDisplay"].as_str().unwrap().to_owned();
    let dir = compositor.dir.path();
    let mut open = |title: &str, x: i64| {
        let mut client = Client::open_listening(dir, &display, "dev.dashi.test", title);
        let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
            .as_u64()
            .unwrap();
        ipc.request("place", json!({ "window": id, "x": x, "y": 50 }));
        wait_event(&mut ipc, &mut client, "window-opened");
        (client, id)
    };
    let (mut target, id) = open("Target", 100);
    // The person's window: opened last, it has their keyboard.
    let (mut theirs, their_id) = open("Theirs", 600);
    let focused = |ipc: &mut crate::support::compositor::Ipc| {
        let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
        let list = windows.as_array().unwrap();
        list.iter()
            .find(|w| w["focused"] == true)
            .map(|w| w["id"].as_u64().unwrap())
    };
    assert_eq!(focused(&mut ipc), Some(their_id));

    // The person was just here (the compositor started): a borrowed seat would be refused.
    let click = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 60000 },
        "pointer": { "x": 20, "y": 30 }, "action": "click",
    });
    assert_eq!(ipc.request("agent-input", click)["result"], json!({}));
    let typed = json!({ "window": id, "label": "Claude", "borrow": { "idleMs": 60000 }, "keys": [{ "text": "hi" }] });
    assert_eq!(ipc.request("agent-input", typed)["result"], json!({}));
    target.roundtrip();
    theirs.roundtrip();
    assert_eq!(target.state.buttons, [true, false]);
    let pressed: Vec<bool> = target
        .state
        .keyboard
        .keys
        .iter()
        .map(|(_, down)| *down)
        .collect();
    assert_eq!(pressed, [true, false, true, false]);
    // Nothing of the person's moved: their keyboard, their window in front, their pointer.
    assert!(theirs.state.keyboard.focused && theirs.state.keyboard.keys.is_empty());
    assert_eq!(focused(&mut ipc), Some(their_id));
    assert_eq!(
        ipc.request("session", json!({}))["result"]["pointer"],
        session["pointer"]
    );

    // A drag is the seat's: it waits for the person as before.
    let press = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 60000 },
        "pointer": { "x": 20, "y": 30 }, "action": "press",
    });
    let refused = ipc.request("agent-input", press)["error"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        refused.starts_with("the person is using the desktop"),
        "{refused}"
    );
    assert_eq!(
        ipc.request("agent-input", json!({ "release": true }))["result"],
        json!({})
    );
    target.roundtrip();
    assert!(!target.state.pointer_in);
}
