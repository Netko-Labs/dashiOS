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
