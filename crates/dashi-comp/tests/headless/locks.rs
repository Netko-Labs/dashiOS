//! A game's lock on the pointer: it takes hold with the pointer and the keyboard
//! in its window, and lets go when the person goes elsewhere.

use serde_json::json;

use super::fixtures::{hand, wait_client, wait_event};
use crate::support::{
    client::Client,
    compositor::{Compositor, Ipc},
};

/// A window that locks the pointer, placed at 200, 200, and a plain one beside it: their ids.
fn game_and_another(compositor: &Compositor, ipc: &mut Ipc) -> (Client, u64, Client, u64) {
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let dir = compositor.dir.path();
    let mut other = Client::open(dir, &display, "dev.dashi.test", "Other");
    let other_id = wait_event(ipc, &mut other, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": other_id, "x": 700, "y": 200 }));
    wait_event(ipc, &mut other, "window-opened");
    let mut game = Client::open_locking(dir, &display, "dev.dashi.game", "Game");
    let id = wait_event(ipc, &mut game, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 200, "y": 200 }));
    wait_event(ipc, &mut game, "window-opened");
    (game, id, other, other_id)
}

#[test]
fn a_lock_takes_hold_with_the_pointer_and_the_keyboard_and_goes_with_the_keyboard() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut game, id, _other, other_id) = game_and_another(&compositor, &mut ipc);
    // The keyboard is in the game (it opened last) and the pointer is not: it is
    // brought there, and the lock holds.
    wait_client(&mut game, "the lock never took hold", |state| {
        state.locks == [true] && state.pointer_in
    });
    let _ = id;

    // ❖Tab to another window: the lock lets go, though the pointer never moved.
    assert_eq!(
        ipc.request("focus", json!({ "window": other_id }))["result"],
        json!({})
    );
    wait_client(
        &mut game,
        "the lock held after the keyboard left",
        |state| state.locks == [true, false],
    );

    // And back: it holds again.
    assert_eq!(
        ipc.request("focus", json!({ "window": id }))["result"],
        json!({})
    );
    wait_client(&mut game, "the lock never came back", |state| {
        state.locks == [true, false, true]
    });
}

#[test]
fn a_lock_waits_for_the_keyboard() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut game, id, _other, other_id) = game_and_another(&compositor, &mut ipc);
    ipc.request("focus", json!({ "window": other_id }));
    wait_client(
        &mut game,
        "the lock held after the keyboard left",
        |state| state.locks == [true, false],
    );
    // The pointer comes over the game while the keyboard is elsewhere: no lock.
    assert_eq!(hand(&mut ipc, id, 20.0, 20.0, "move")["result"], json!({}));
    wait_client(&mut game, "the pointer never entered", |state| {
        state.pointer_in
    });
    ipc.request("windows", json!({}));
    game.roundtrip();
    assert_eq!(game.state.locks, [true, false]);
    // The keyboard comes: it holds.
    ipc.request("focus", json!({ "window": id }));
    wait_client(&mut game, "the lock never took hold", |state| {
        state.locks == [true, false, true]
    });
}

#[test]
fn mission_control_lets_a_lock_go() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut game, id, _other, _) = game_and_another(&compositor, &mut ipc);
    wait_client(&mut game, "the lock never took hold", |state| {
        state.locks == [true]
    });
    let plan = json!({ "windows": [{ "id": id, "rect": { "x": 200, "y": 200, "width": 160, "height": 100 } }] });
    assert_eq!(ipc.request("overview", plan)["result"], json!({}));
    // (Heard once more when the pointer then leaves the window for the overview.)
    wait_client(&mut game, "the lock held under the overview", |state| {
        state.locks.last() == Some(&false)
    });
}
