//! The pointer and windows under it: moves from under a still pointer, and a window held against an edge.

use std::{
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::json;

use super::fixtures::{grab, hand, movable_window, wait_client, wait_event};
use crate::support::compositor::Compositor;

#[test]
fn a_window_moved_from_under_a_still_pointer_hears_it_leave() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, id) = movable_window(&compositor, &mut ipc, 200, 200);
    assert_eq!(hand(&mut ipc, id, 20.0, 20.0, "move")["result"], json!({}));
    wait_client(&mut client, "the pointer never entered", |state| {
        state.pointer_in
    });
    // Tiled away (the shell places it elsewhere); the pointer doesn't move.
    ipc.request("place", json!({ "window": id, "x": 700, "y": 500 }));
    wait_client(
        &mut client,
        "the window never heard the pointer leave",
        |state| !state.pointer_in,
    );
    // And back under it: entered again, with no motion.
    ipc.request("place", json!({ "window": id, "x": 200, "y": 200 }));
    wait_client(&mut client, "the pointer never entered again", |state| {
        state.pointer_in
    });
}

#[test]
fn a_window_held_against_an_edge_is_told_after_a_while() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, id) = movable_window(&compositor, &mut ipc, 0, 300);
    grab(&mut ipc, &mut client, id, 30.0, 40.0);
    // To the screen's left edge (the window's left side is there).
    let began = Instant::now();
    assert_eq!(hand(&mut ipc, id, 0.0, 40.0, "move")["result"], json!({}));
    let hold = wait_event(&mut ipc, &mut client, "edge-hold");
    assert!(
        began.elapsed() >= Duration::from_millis(380),
        "held for 400 ms first"
    );
    assert_eq!(
        hold,
        json!({ "event": "edge-hold", "edge": "left", "output": "HEADLESS-1", "window": id, "count": 1, "preview": false })
    );
    // Still there: told again.
    assert_eq!(wait_event(&mut ipc, &mut client, "edge-hold")["count"], 2);

    // Off the edge, then let go: no more.
    assert_eq!(hand(&mut ipc, id, 60.0, 40.0, "move")["result"], json!({}));
    assert_eq!(
        hand(&mut ipc, id, 60.0, 40.0, "release")["result"],
        json!({})
    );
    ipc.events.retain(|e| e["event"] != "edge-hold");
    sleep(Duration::from_millis(900));
    client.dispatch();
    ipc.request("windows", json!({}));
    assert!(
        ipc.events.iter().all(|e| e["event"] != "edge-hold"),
        "a hold ends when the window leaves the edge"
    );
}
