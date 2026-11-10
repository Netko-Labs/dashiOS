//! Waiting for events and finding windows, shared by the tests.

use std::{
    io::BufRead,
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::support::{
    client::Client,
    compositor::{Compositor, Ipc},
};

/// Read events until one named `name` arrives (or give up after a while).
pub(super) fn wait_event(ipc: &mut Ipc, client: &mut Client, name: &str) -> Value {
    if let Some(at) = ipc.events.iter().position(|e| e["event"] == name) {
        return ipc.events.remove(at);
    }
    ipc.stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    let start = Instant::now();
    loop {
        client.dispatch();
        let mut line = String::new();
        if ipc.reader.read_line(&mut line).is_ok() && !line.is_empty() {
            let event: Value = serde_json::from_str(&line).unwrap();
            if event["event"] == name {
                ipc.stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                return event;
            }
        }
        assert!(start.elapsed() < Duration::from_secs(10), "no {name} event");
    }
}

/// A movable window placed at `x, y`, with the shell listening: its id.
pub(super) fn movable_window(
    compositor: &Compositor,
    ipc: &mut Ipc,
    x: i64,
    y: i64,
) -> (Client, u64) {
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client =
        Client::open_movable(compositor.dir.path(), &display, "dev.dashi.test", "Held");
    let id = wait_event(ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": x, "y": y }));
    wait_event(ipc, &mut client, "window-opened");
    (client, id)
}

/// The person's pointer, moved by an agent borrowing the seat (the person is away).
pub(super) fn hand(ipc: &mut Ipc, window: u64, x: f64, y: f64, action: &str) -> Value {
    let params = json!({ "window": window, "label": "Test", "pointer": { "x": x, "y": y }, "action": action, "borrow": { "idleMs": 0 } });
    ipc.request("agent-input", params)
}

/// Press in the window until the client has asked to be moved and the compositor holds it.
pub(super) fn grab(ipc: &mut Ipc, client: &mut Client, window: u64, x: f64, y: f64) {
    assert_eq!(hand(ipc, window, x, y, "press")["result"], json!({}));
    let start = Instant::now();
    while client.state.moves == 0 {
        client.dispatch();
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the client never asked to move"
        );
        sleep(Duration::from_millis(10));
    }
    // Requests are handled in order with the client's, a little later: let it land.
    sleep(Duration::from_millis(100));
    ipc.request("windows", json!({}));
}

pub(super) fn window_named(ipc: &mut Ipc, id: u64) -> Value {
    let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
    windows
        .as_array()
        .and_then(|list| list.iter().find(|w| w["id"] == id).cloned())
        .expect("the window is listed")
}

/// Dispatch `client` until `done` holds of its state, for up to five seconds.
pub(super) fn wait_client(
    client: &mut Client,
    what: &str,
    done: impl Fn(&crate::support::client::State) -> bool,
) {
    let start = Instant::now();
    while !done(&client.state) {
        client.dispatch();
        assert!(start.elapsed() < Duration::from_secs(5), "{what}");
        sleep(Duration::from_millis(10));
    }
}
