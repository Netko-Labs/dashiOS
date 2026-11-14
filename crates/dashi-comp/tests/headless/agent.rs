//! Agents and clients: acting in one window with a seat of their own, and the protocols a plain client may not see.

use serde_json::{Value, json};

use super::fixtures::wait_event;
use crate::support::{
    client::{Client, globals},
    compositor::Compositor,
};

#[test]
fn an_agent_acts_in_one_window_with_its_own_seat() {
    let compositor = Compositor::start_with(&[], &[("DASHI_AGENT_SEAT", "1")]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Agent");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    let click = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "action": "click", "button": "left" });
    assert_eq!(ipc.request("agent-input", click)["result"], json!({}));
    let typed = json!({ "window": id, "label": "Claude", "keys": [{ "text": "Hi!" }, { "name": "Control_L", "state": "down" }, { "name": "a" }, { "name": "Control_L", "state": "up" }] });
    assert_eq!(ipc.request("agent-input", typed)["result"], json!({}));
    let outside = json!({ "window": id, "label": "Claude", "pointer": { "x": 5000, "y": 30 }, "action": "click" });
    assert!(
        ipc.request("agent-input", outside)["error"]
            .as_str()
            .unwrap()
            .contains("outside")
    );
    let busy = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "borrow": { "idleMs": 60000 } });
    // The refusal names how long until the seat is free.
    let refused = ipc.request("agent-input", busy)["error"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        refused.starts_with("the person is using the desktop (free in ")
            && refused.ends_with(" ms)"),
        "{refused}"
    );
    assert_eq!(
        ipc.request("agent-input", json!({ "release": true }))["result"],
        json!({})
    );
}

#[test]
fn a_plain_client_sees_no_privileged_protocols() {
    for mode in [&[][..], &["--greeter"][..]] {
        let compositor = Compositor::start(mode);
        let mut ipc = compositor.connect();
        let session = ipc.request("session", json!({}))["result"].clone();
        // Headless and greeter mode never start Xwayland.
        assert_eq!(session["xwayland"], "off");
        assert_eq!(session["display"], Value::Null);
        let display = session["waylandDisplay"].as_str().unwrap().to_owned();
        let seen = globals(compositor.dir.path(), &display);
        for modern in [
            "zwp_primary_selection_device_manager_v1",
            "wp_viewporter",
            "wp_fractional_scale_manager_v1",
            "wp_single_pixel_buffer_manager_v1",
            "wp_cursor_shape_manager_v1",
            "zwp_pointer_constraints_v1",
            "zwp_relative_pointer_manager_v1",
            "zwp_pointer_gestures_v1",
            "zwp_idle_inhibit_manager_v1",
            "zwp_keyboard_shortcuts_inhibit_manager_v1",
            "zwp_text_input_manager_v3",
            "wp_security_context_manager_v1",
            // xdg_toplevel_icon_manager_v1 is off for now (handlers/toplevel_meta.rs).
            "xdg_system_bell_v1",
            "zxdg_exporter_v2",
            "zxdg_importer_v2",
        ] {
            assert!(
                seen.iter().any(|g| g == modern),
                "{modern} is missing in {mode:?}"
            );
        }
        for privileged in [
            "zwlr_foreign_toplevel_manager_v1",
            "zwlr_screencopy_manager_v1",
            "ext_data_control_manager_v1",
            "zwlr_data_control_manager_v1",
            "ext_session_lock_manager_v1",
            "zwp_input_method_manager_v2",
            "zwp_virtual_keyboard_manager_v1",
            "ext_image_copy_capture_manager_v1",
            "ext_output_image_capture_source_manager_v1",
            "ext_foreign_toplevel_image_capture_source_manager_v1",
            "ext_foreign_toplevel_list_v1",
        ] {
            assert!(
                !seen.iter().any(|g| g == privileged),
                "{privileged} is shown in {mode:?}"
            );
        }
    }
}

#[test]
fn without_its_own_seat_an_agent_waits_for_the_person() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    // One wl_seat: a second would take single-seat toolkits' keyboards away.
    let seats = globals(compositor.dir.path(), &display)
        .into_iter()
        .filter(|g| g == "wl_seat")
        .count();
    assert_eq!(seats, 1);
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Agent");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    // Just started counts as the person being there: the agent must wait.
    let click = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "action": "click" });
    let refused = ipc.request("agent-input", click)["error"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        refused.starts_with("the person is using the desktop (free in "),
        "{refused}"
    );
}

/// A drag in a window that hears only the person's seat (Metal's, Chromium's): press, moves and
/// release are separate requests on the borrowed seat, and `release` lets go there too.
#[test]
fn an_agent_drags_on_the_persons_seat_and_lets_go_of_it() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client =
        Client::open_listening(compositor.dir.path(), &display, "dev.dashi.test", "Drag");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    let mut step = |x: i64, action: &str| {
        let input = json!({
            "window": id, "label": "Claude", "borrow": { "idleMs": 0 },
            "pointer": { "x": x, "y": 30 }, "action": action,
        });
        assert_eq!(ipc.request("agent-input", input)["result"], json!({}));
    };
    step(20, "press");
    step(40, "move");
    step(60, "move");
    step(80, "release");
    client.roundtrip();
    assert_eq!(client.state.buttons, [true, false], "pressed, then let go");
    assert!(client.state.motions >= 3, "it moved between them");

    // A drag cut short (the stop key, the person back): the button is let go on the seat it is held on.
    step(20, "press");
    assert_eq!(
        ipc.request("agent-input", json!({ "release": true }))["result"],
        json!({})
    );
    client.roundtrip();
    assert_eq!(client.state.buttons, [true, false, true, false]);
}

/// A window on a Space that does not show hears the agent, and nothing of the person's moves:
/// no wait for them to pause, their pointer where it was, the Space that shows as it is.
#[test]
fn an_agent_acts_in_a_window_on_a_space_that_does_not_show() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let session = ipc.request("session", json!({}))["result"].clone();
    let display = session["waylandDisplay"].as_str().unwrap().to_owned();
    assert_eq!(ipc.request("space-add", json!({}))["result"]["space"], 1);
    let mut client =
        Client::open_listening(compositor.dir.path(), &display, "dev.dashi.test", "Away");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request(
        "place",
        json!({ "window": id, "x": 100, "y": 50, "space": 1 }),
    );
    wait_event(&mut ipc, &mut client, "window-opened");
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert!(window["frame"].is_null(), "off screen");
    assert_eq!(
        (
            window["away"]["x"].as_i64(),
            window["away"]["width"].as_i64()
        ),
        (Some(100), Some(320)),
        "where it waits"
    );

    // The person was just here (the compositor started): on screen the agent would wait.
    let click = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 60000 },
        "pointer": { "x": 20, "y": 30 }, "action": "click",
    });
    assert_eq!(ipc.request("agent-input", click)["result"], json!({}));
    let typed = json!({ "window": id, "label": "Claude", "borrow": { "idleMs": 60000 }, "keys": [{ "text": "Hi" }] });
    assert_eq!(ipc.request("agent-input", typed)["result"], json!({}));
    client.roundtrip();
    assert_eq!(client.state.buttons, [true, false]);
    assert!(client.state.pointer_in, "its pointer stays in the window");
    let keys = &client.state.keyboard;
    // Shift, h, h, Shift, i, i: the agent's own Shift, let go again.
    let pressed: Vec<bool> = keys.keys.iter().map(|(_, down)| *down).collect();
    assert_eq!(pressed, [true, true, false, false, true, false]);
    assert_eq!((keys.enters, keys.focused, keys.depressed), (1, false, 0));
    let outside = json!({ "window": id, "label": "Claude", "pointer": { "x": 5000, "y": 30 }, "action": "click" });
    assert!(
        ipc.request("agent-input", outside)["error"]
            .as_str()
            .unwrap()
            .contains("outside")
    );

    // Raised where it is: the Space that shows stays, and so does the person's pointer.
    assert_eq!(
        ipc.request("focus", json!({ "window": id, "stay": true }))["result"],
        json!({})
    );
    assert_eq!(ipc.request("spaces", json!({}))["result"]["current"], 0);
    assert_eq!(
        ipc.request("session", json!({}))["result"]["pointer"],
        session["pointer"]
    );
    // Letting go takes its pointer out of the window.
    assert_eq!(
        ipc.request("agent-input", json!({ "release": true }))["result"],
        json!({})
    );
    client.roundtrip();
    assert!(!client.state.pointer_in);
}
