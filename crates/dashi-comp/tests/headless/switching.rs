//! Switching spaces: held windows, order on return, and full screen.

use serde_json::json;

use super::fixtures::{grab, hand, movable_window, wait_event, window_named};
use crate::support::{client::Client, compositor::Compositor};

#[test]
fn full_screen_covers_the_screen_and_gives_the_frame_back() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Full");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": true }))["result"],
        json!({})
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["fullscreen"], true);
    assert_eq!(window["titleBar"], 0);
    assert_eq!(window["frame"]["x"], 0);
    assert_eq!(window["frame"]["y"], 0);

    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": false }))["result"],
        json!({})
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["fullscreen"], false);
    assert_eq!(
        (window["frame"]["x"].as_i64(), window["frame"]["y"].as_i64()),
        (Some(100), Some(50))
    );

    assert_eq!(
        ipc.request("bars", json!({ "top": 1 }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("bars", json!({ "show": true, "output": "HEADLESS-1" }))["result"],
        json!({})
    );
    assert!(ipc.request("fullscreen", json!({ "window": id }))["error"].is_string());
}

#[test]
fn a_held_window_goes_along_when_the_space_changes() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, id) = movable_window(&compositor, &mut ipc, 400, 300);
    ipc.request("chrome", json!({ "reduceMotion": true }));
    ipc.request("space-add", json!({}));
    wait_event(&mut ipc, &mut client, "space");
    // A window already waiting on the Space it will be carried to.
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut other = Client::open(compositor.dir.path(), &display, "dev.dashi.other", "There");
    let there = wait_event(&mut ipc, &mut other, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": there, "x": 300, "y": 200 }));
    wait_event(&mut ipc, &mut other, "window-opened");
    ipc.request("space-move", json!({ "window": there, "space": 1 }));
    wait_event(&mut ipc, &mut other, "window-space");
    ipc.request("focus", json!({ "window": id }));

    grab(&mut ipc, &mut client, id, 40.0, 40.0);
    // Dragged 30 to the right and 20 down.
    assert_eq!(hand(&mut ipc, id, 70.0, 60.0, "move")["result"], json!({}));
    let moved = window_named(&mut ipc, id)["frame"].clone();
    assert_eq!(
        (moved["x"].as_i64(), moved["y"].as_i64()),
        (Some(430), Some(320))
    );

    // The Desktop changes mid-drag (a shortcut, a swipe): the window comes along, still held.
    assert_eq!(
        ipc.request("space-switch", json!({ "space": 1 }))["result"]["count"],
        2
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 1 })
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "space"),
        json!({ "event": "space", "current": 1, "previous": 0, "count": 2 })
    );
    let carried = window_named(&mut ipc, id);
    assert_eq!(carried["space"], 1);
    assert_eq!(carried["frame"]["x"], 430, "on screen, where it was held");
    // In front of the windows that were there, with the keyboard.
    assert_eq!(carried["focused"], true);
    assert_eq!(window_named(&mut ipc, there)["focused"], false);

    // Still in hand: it follows the pointer on the new Desktop, and stays there when let go.
    // (Points are in the window, which moves with the pointer: 50 in is 10 further right.)
    assert_eq!(hand(&mut ipc, id, 50.0, 40.0, "move")["result"], json!({}));
    assert_eq!(
        hand(&mut ipc, id, 40.0, 40.0, "release")["result"],
        json!({})
    );
    let dropped = window_named(&mut ipc, id);
    assert_eq!(
        (dropped["frame"]["x"].as_i64(), dropped["space"].as_u64()),
        (Some(440), Some(1))
    );

    // Let go, it stays on its Desktop when the person goes back.
    ipc.request("space-switch", json!({ "space": 0 }));
    wait_event(&mut ipc, &mut client, "space");
    let left = window_named(&mut ipc, id);
    assert_eq!(
        (left["space"].as_u64(), left["frame"].is_null()),
        (Some(1), true)
    );
}

#[test]
fn a_desktop_comes_back_in_the_order_its_windows_had() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    ipc.request("subscribe", json!({}));
    ipc.request("chrome", json!({ "reduceMotion": true }));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    // Two windows, one over the other; the older one is brought to the front.
    let mut older = Client::open(compositor.dir.path(), &display, "dev.dashi.older", "Older");
    let first = wait_event(&mut ipc, &mut older, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": first, "x": 100, "y": 100 }));
    wait_event(&mut ipc, &mut older, "window-opened");
    let mut newer = Client::open(compositor.dir.path(), &display, "dev.dashi.newer", "Newer");
    let second = wait_event(&mut ipc, &mut newer, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": second, "x": 100, "y": 100 }));
    wait_event(&mut ipc, &mut newer, "window-opened");
    ipc.request("focus", json!({ "window": first }));
    assert_eq!(window_named(&mut ipc, first)["focused"], true);

    ipc.request("space-add", json!({}));
    wait_event(&mut ipc, &mut older, "space");
    ipc.request("space-switch", json!({ "space": 1 }));
    wait_event(&mut ipc, &mut older, "space");
    ipc.request("space-switch", json!({ "space": 0 }));
    wait_event(&mut ipc, &mut older, "space");

    // Back as it was: the older window still in front, with the keyboard.
    assert_eq!(window_named(&mut ipc, first)["focused"], true);
    assert_eq!(window_named(&mut ipc, second)["focused"], false);
}

#[test]
fn a_switch_carries_the_window_asked_and_keeps_it_on_screen() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    ipc.request("subscribe", json!({}));
    ipc.request("chrome", json!({ "reduceMotion": true }));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.game", "Game");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 120, "y": 80 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    ipc.request("space-add", json!({}));
    wait_event(&mut ipc, &mut client, "space");

    // Only a window on the Space that shows, and not with `progress`.
    assert!(ipc.request("space-switch", json!({ "space": 1, "carry": 999 }))["error"].is_string());
    assert!(
        ipc.request(
            "space-switch",
            json!({ "space": 1, "carry": id, "progress": 0.5 })
        )["error"]
            .is_string()
    );

    assert_eq!(
        ipc.request("space-switch", json!({ "space": 1, "carry": id }))["result"]["count"],
        2
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 1 })
    );
    wait_event(&mut ipc, &mut client, "space");
    let carried = window_named(&mut ipc, id);
    assert_eq!(carried["space"], 1);
    assert_eq!(
        (carried["frame"]["x"].as_i64(), carried["focused"].as_bool()),
        (Some(120), Some(true)),
        "on screen where it was, with the keyboard"
    );

    // Carried once: the next switch leaves it where it is.
    ipc.request("space-switch", json!({ "space": 0 }));
    wait_event(&mut ipc, &mut client, "space");
    let left = window_named(&mut ipc, id);
    assert_eq!(
        (left["space"].as_u64(), left["frame"].is_null()),
        (Some(1), true)
    );
}
