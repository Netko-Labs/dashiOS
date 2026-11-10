//! Spaces: keeping their windows, going in where asked, and the overview.

use serde_json::json;

use super::fixtures::{wait_event, window_named};
use crate::support::{client::Client, compositor::Compositor};

#[test]
fn spaces_keep_their_windows() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Spaced");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    assert_eq!(
        ipc.request("spaces", json!({ "follow": false }))["result"],
        json!({ "count": 1, "current": 0 })
    );
    let added = ipc.request("space-add", json!({}))["result"].clone();
    assert_eq!(added, json!({ "count": 2, "current": 0, "space": 1 }));
    // Adding one says so: the count changed.
    assert_eq!(
        wait_event(&mut ipc, &mut client, "space"),
        json!({ "event": "space", "current": 0, "previous": 0, "count": 2 })
    );

    assert_eq!(
        ipc.request("space-move", json!({ "window": id, "space": 1 }))["result"],
        json!({})
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 1 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(
        (window["space"].as_u64(), window["frame"].is_null()),
        (Some(1), true),
        "off screen on another Space"
    );

    assert_eq!(
        ipc.request("space-switch", json!({ "space": 1 }))["result"]["count"],
        2
    );
    let event = wait_event(&mut ipc, &mut client, "space");
    assert_eq!(
        event,
        json!({ "event": "space", "current": 1, "previous": 0, "count": 2 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["frame"]["x"], 100, "back where it was");

    // Fewer Spaces: windows on the ones that go join the last one left.
    assert_eq!(
        ipc.request("spaces", json!({ "count": 1 }))["result"],
        json!({ "count": 1, "current": 0 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(
        (window["space"].as_u64(), window["frame"]["x"].as_i64()),
        (Some(0), Some(100))
    );
    assert!(ipc.request("space-switch", json!({ "space": 5 }))["error"].is_string());
    assert!(ipc.request("spaces", json!({ "count": 0 }))["error"].is_string());
}

#[test]
fn a_space_goes_in_where_asked_and_windows_wait_on_theirs() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    ipc.request("chrome", json!({ "reduceMotion": true }));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Game");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    // A Space at an index: the ones from there move up one, their windows with them.
    ipc.request("space-add", json!({}));
    ipc.request("space-move", json!({ "window": id, "space": 1 }));
    ipc.events.clear();
    assert_eq!(
        ipc.request("space-add", json!({ "at": 1 }))["result"],
        json!({ "count": 3, "current": 0, "space": 1 })
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 2 })
    );
    assert!(ipc.request("space-add", json!({ "at": 9 }))["error"].is_string());

    // Full screen on a Space that is not shown: full screen there when it shows.
    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": true }))["result"],
        json!({})
    );
    let waiting = window_named(&mut ipc, id);
    assert_eq!(
        (waiting["fullscreen"].as_bool(), waiting["frame"].is_null()),
        (Some(true), true),
        "still off screen"
    );
    ipc.request("space-switch", json!({ "space": 2 }));
    let shown = window_named(&mut ipc, id);
    assert_eq!(
        (shown["frame"]["x"].as_i64(), shown["frame"]["y"].as_i64()),
        (Some(0), Some(0))
    );

    // Out of full screen off screen: back at its frame when its Space shows.
    ipc.request("space-move", json!({ "window": id, "space": 0 }));
    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": false }))["result"],
        json!({})
    );
    assert!(window_named(&mut ipc, id)["frame"].is_null());
    // A frame for it meanwhile is where it waits too.
    ipc.request(
        "frame",
        json!({ "window": id, "x": 300, "y": 200, "width": 320, "height": 228 }),
    );
    assert!(window_named(&mut ipc, id)["frame"].is_null(), "not shown");
    ipc.request("space-switch", json!({ "space": 0 }));
    let back = window_named(&mut ipc, id);
    assert_eq!(
        (back["frame"]["x"].as_i64(), back["frame"]["y"].as_i64()),
        (Some(300), Some(200))
    );

    // Minimized and shown again: the shell is told.
    ipc.events.clear();
    ipc.request("minimize", json!({ "window": id }));
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-state"),
        json!({ "event": "window-state", "window": id, "state": "minimized" })
    );
    ipc.request("focus", json!({ "window": id }));
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-state"),
        json!({ "event": "window-state", "window": id, "state": "normal" })
    );

    // A dialog says whose it is, and can be placed on another Space, where it waits.
    client.open_dialog("Settings");
    let placing = wait_event(&mut ipc, &mut client, "window-placing")["window"].clone();
    assert_eq!(placing["parent"], id);
    let dialog = placing["id"].as_u64().unwrap();
    assert!(
        ipc.request(
            "place",
            json!({ "window": dialog, "x": 10, "y": 10, "space": 7 })
        )["error"]
            .is_string()
    );
    assert_eq!(
        ipc.request(
            "place",
            json!({ "window": dialog, "x": 10, "y": 10, "space": 1 })
        )["result"],
        json!({})
    );
    let opened = wait_event(&mut ipc, &mut client, "window-opened")["window"].clone();
    assert_eq!(
        (
            opened["space"].as_u64(),
            opened["frame"].is_null(),
            opened["parent"].as_u64()
        ),
        (Some(1), true, Some(id))
    );
    assert_eq!(
        window_named(&mut ipc, id)["focused"],
        true,
        "the keyboard stays"
    );
    ipc.request("space-switch", json!({ "space": 1 }));
    let there = window_named(&mut ipc, dialog);
    assert_eq!(
        (there["frame"]["x"].as_i64(), there["frame"]["y"].as_i64()),
        (Some(10), Some(10))
    );
}

#[test]
fn the_overview_opens_on_a_plan_and_closes() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Over");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    let plan = json!({ "windows": [{ "id": id, "rect": { "x": 200, "y": 200, "width": 160, "height": 100 } }] });
    assert_eq!(ipc.request("overview", plan.clone())["result"], json!({}));
    assert_eq!(
        wait_event(&mut ipc, &mut client, "overview"),
        json!({ "event": "overview", "active": true })
    );
    // Laid out again while open: no second "opened".
    assert_eq!(ipc.request("overview", plan)["result"], json!({}));
    assert_eq!(
        ipc.request("overview", json!({ "duration": 0 }))["result"],
        json!({})
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "overview"),
        json!({ "event": "overview", "active": false })
    );

    assert!(ipc.request("overview", json!({ "windows": [{ "id": id }] }))["error"].is_string());
    assert!(ipc.request("overview", json!({ "windows": 3 }))["error"].is_string());
}
