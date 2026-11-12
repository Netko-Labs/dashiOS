//! Windows: placing them, their order, sheets and portal parents.

use std::{
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::json;

use super::fixtures::wait_event;
use crate::support::{
    client::Client,
    compositor::{Compositor, Ipc},
};

#[test]
fn a_window_waits_for_the_shell_to_place_it() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "A test");
    let placing = wait_event(&mut ipc, &mut client, "window-placing");
    let window = &placing["window"];
    assert_eq!(window["appId"], "dev.dashi.test");
    assert_eq!(window["title"], "A test");
    assert_eq!(
        (window["width"].as_i64(), window["height"].as_i64()),
        (Some(320), Some(200))
    );
    let id = window["id"].as_u64().unwrap();
    assert!(
        ipc.request("windows", json!({}))["result"]["windows"]
            .as_array()
            .unwrap()
            .is_empty(),
        "not shown until placed"
    );

    assert_eq!(
        ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }))["result"],
        json!({})
    );
    let opened = wait_event(&mut ipc, &mut client, "window-opened");
    assert_eq!(opened["window"]["id"], id);
    assert_eq!(
        opened["window"]["frame"],
        json!({ "x": 100, "y": 50, "width": 320, "height": 200 })
    );
    assert_eq!(opened["window"]["focused"], true);

    assert_eq!(
        ipc.request("close", json!({ "window": id }))["result"],
        json!({})
    );
    let start = Instant::now();
    while !client.state.closed {
        client.dispatch();
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the client was not asked to close"
        );
    }
}

#[test]
fn with_no_shell_a_window_places_itself() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "foot", "foot");
    let start = Instant::now();
    loop {
        client.dispatch();
        let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
        if let Some(window) = windows.as_array().and_then(|w| w.first()) {
            assert_eq!(window["appId"], "foot");
            assert!(window["frame"].is_object());
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the window was never shown"
        );
        sleep(Duration::from_millis(20));
    }
}

#[test]
fn windows_are_listed_most_recently_used_first() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut open = |title: &str, x: i64| {
        let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", title);
        let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
            .as_u64()
            .unwrap();
        ipc.request("place", json!({ "window": id, "x": x, "y": 50 }));
        wait_event(&mut ipc, &mut client, "window-opened");
        (client, id)
    };
    let (_a, first) = open("First", 100);
    let (_b, second) = open("Second", 300);
    let (_c, third) = open("Third", 500);
    let order = |ipc: &mut Ipc| -> Vec<u64> {
        ipc.request("windows", json!({}))["result"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["id"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(
        order(&mut ipc),
        vec![third, second, first],
        "the newest has the keyboard"
    );
    ipc.request("focus", json!({ "window": first }));
    assert_eq!(order(&mut ipc), vec![first, third, second]);
    // Minimized windows come after those that show.
    ipc.request("minimize", json!({ "window": first }));
    assert_eq!(order(&mut ipc).last(), Some(&first));
}

#[test]
fn a_sheet_hangs_where_the_shell_says_on_a_window_that_draws_its_own_bar() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    // The test client draws its own frame: dashi-comp gives it no title bar.
    let mut parent = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Parent");
    let parent_id = wait_event(&mut ipc, &mut parent, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": parent_id, "x": 100, "y": 100 }));
    wait_event(&mut ipc, &mut parent, "window-opened");
    let mut sheet = Client::open(compositor.dir.path(), &display, "dev.dashi.portal", "Open");
    let sheet_id = wait_event(&mut ipc, &mut sheet, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();

    // Below the app's own title bar and toolbar, as tall as the shell says.
    let attach = json!({ "window": sheet_id, "parent": parent_id, "top": 60 });
    assert_eq!(ipc.request("attach", attach)["result"], json!({}));
    wait_event(&mut ipc, &mut sheet, "window-opened");
    let frame = |ipc: &mut Ipc| {
        let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
        let sheet = windows
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["id"] == sheet_id)
            .cloned()
            .unwrap();
        (sheet["frame"]["x"].as_i64(), sheet["frame"]["y"].as_i64())
    };
    assert_eq!(frame(&mut ipc), (Some(100), Some(160)));

    // Without `top`, at the top of the parent's content: it has no bar of dashi-comp's.
    let again = json!({ "window": sheet_id, "parent": parent_id });
    assert_eq!(ipc.request("attach", again)["result"], json!({}));
    assert_eq!(frame(&mut ipc), (Some(100), Some(100)));
    let bad = json!({ "window": sheet_id, "parent": parent_id, "top": "60" });
    assert!(ipc.request("attach", bad)["error"].is_string());
}

#[test]
fn portal_parents_and_sheets_are_checked() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    // A handle nobody exported, or one of no kind the portal passes, names no window.
    for handle in [
        "wayland:nothing-exported-this",
        "x11:3e00004",
        "x11:zz",
        "other:1",
        "",
    ] {
        assert_eq!(
            ipc.request("window-for-handle", json!({ "handle": handle }))["result"],
            json!({ "window": null }),
            "{handle}"
        );
    }
    assert!(
        ipc.request("window-for-handle", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("handle")
    );
    assert_eq!(
        ipc.request("attach", json!({ "window": 1, "parent": 2 }))["error"],
        "no window 1"
    );
    assert!(
        ipc.request("attach", json!({ "window": 1, "parent": "2" }))["error"]
            .as_str()
            .unwrap()
            .contains("parent")
    );
}
