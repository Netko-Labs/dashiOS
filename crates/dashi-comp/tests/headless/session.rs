//! The session: its sockets and lifetime, the GPU and seat, configuration, keymaps and idle.

use std::{
    process::Command,
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::json;

use super::fixtures::wait_event;
use crate::support::{client::Client, compositor::Compositor};

#[test]
fn the_session_client_gets_the_sockets_and_ends_the_session() {
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("env");
    let command = format!(
        "echo \"$WAYLAND_DISPLAY $DASHI_COMP_SOCKET\" > '{}'",
        file.display()
    );
    let mut compositor = Compositor::spawn(&["-c", &command]);

    let start = Instant::now();
    let status = loop {
        if let Some(status) = compositor.child.try_wait().unwrap() {
            break status;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the compositor outlived its client"
        );
        sleep(Duration::from_millis(20));
    };
    assert!(status.success());
    let seen = std::fs::read_to_string(&file).unwrap();
    let mut parts = seen.split_whitespace();
    assert!(
        parts
            .next()
            .is_some_and(|display| display.starts_with("wayland-"))
    );
    assert_eq!(parts.next(), Some(compositor.socket.to_str().unwrap()));
    assert!(
        !compositor.socket.exists(),
        "the socket is removed on the way out"
    );
}

#[test]
fn a_live_socket_is_not_taken_over() {
    let first = Compositor::start(&[]);
    let second = Command::new(env!("CARGO_BIN_EXE_dashi-comp"))
        .args(["--backend", "headless"])
        .env("DASHI_COMP_SOCKET", &first.socket)
        .env("RUST_LOG", "error")
        .output()
        .unwrap();
    assert!(!second.status.success());
    assert!(String::from_utf8_lossy(&second.stdout).contains("another dashi-comp"));
    // The first still answers.
    assert!(first.connect().request("windows", json!({}))["result"].is_object());
}

#[test]
fn the_shells_configuration_is_answered() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("bars", json!({}))["result"], json!({}));
    let portal = json!({ "paths": ["/usr/libexec/xdg-desktop-portal-wlr"] });
    assert_eq!(
        ipc.request("screencopy-clients", portal)["result"],
        json!({})
    );
    assert!(
        ipc.request("screencopy-clients", json!({ "paths": ["relative"] }))["error"].is_string()
    );
    assert_eq!(
        ipc.request("edges", json!({ "bottom": 4 }))["result"],
        json!({ "inside": false })
    );
    assert_eq!(
        ipc.request("spaces", json!({}))["result"],
        json!({ "count": 1, "current": 0 })
    );
}

#[test]
fn no_gpus_are_held_without_a_seat_of_our_own() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(
        ipc.request("gpus", json!({}))["result"],
        json!({ "gpus": [] })
    );
    assert_eq!(
        ipc.request("gpu-keep", json!({ "card": "card0", "on": true }))["error"],
        "no GPU named card0"
    );
    assert!(ipc.request("gpu-keep", json!({ "card": "card0" }))["error"].is_string());
    assert!(ipc.request("gpu-keep", json!({ "on": false }))["error"].is_string());
}

#[test]
fn the_keymap_is_checked_before_it_is_used() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let keymap = json!({
        "apps": { "terminal": ["foot"] },
        "tapMs": 350,
        "holdMs": 800,
        "rules": [
            { "when": "super+q", "bind": "quit-app" },
            { "when": "super+letter", "app": "terminal", "send": "ctrl+shift+key" },
            { "when": "super+BackSpace", "tap": ["shift+Home", "BackSpace"] },
            { "when": "super+ctrl+*", "swallow": true }
        ],
        // The lock screen's (packages/shell/src/keymap.ts LOCKED_RULES).
        "locked": [
            { "when": "super+a|c|x|v|z", "send": "ctrl+key" },
            { "when": "super+BackSpace", "tap": ["shift+Home", "BackSpace"] },
            { "when": "super+*", "swallow": true }
        ]
    });
    assert_eq!(ipc.request("keymap", keymap)["result"], json!({}));
    // No shell binding fires while locked: a locked rule that binds is refused.
    let refused = ipc.request(
        "keymap",
        json!({ "rules": [], "locked": [{ "when": "super+q", "bind": "quit-app" }] }),
    );
    assert!(
        refused["error"].as_str().unwrap().contains("locked 0"),
        "{refused}"
    );
    let refused = ipc.request(
        "keymap",
        json!({ "rules": [{ "when": "hyper+q", "bind": "x" }] }),
    );
    assert!(
        refused["error"].as_str().unwrap().contains("hyper"),
        "{refused}"
    );
    assert!(
        ipc.request("send-keys", json!({ "window": 9, "chord": "ctrl+z" }))["error"].is_string()
    );
}

#[test]
fn idle_is_told_and_the_claims_are_answered() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    assert_eq!(
        ipc.request("idle", json!({ "timeouts": [1] }))["result"],
        json!({})
    );
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Idle");
    assert_eq!(
        wait_event(&mut ipc, &mut client, "idle"),
        json!({ "event": "idle", "seconds": 1 })
    );

    assert_eq!(
        ipc.request("gestures", json!({ "swipe": [3] }))["result"],
        json!({})
    );
    assert!(ipc.request("idle", json!({}))["error"].is_string());
    assert!(ipc.request("power", json!({}))["error"].is_string());
    assert_eq!(
        ipc.request("power", json!({ "on": false }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("gamma", json!({ "red": 1.0, "green": 0.8, "blue": 0.6 }))["result"],
        json!({})
    );
    assert!(ipc.request("gamma", json!({ "red": 1.0 }))["error"].is_string());
}

#[test]
fn variable_refresh_rate_is_the_shells_choice() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    // No screen to drive headless: it cannot, and it is off.
    assert_eq!(
        screen["vrr"],
        json!({ "supported": false, "active": false, "mode": "off" })
    );
    let choice = json!({ "outputs": [{ "name": "HEADLESS-1", "vrr": "fullscreen" }] });
    assert_eq!(ipc.request("outputs-config", choice)["result"], json!({}));
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    assert_eq!(screen["vrr"]["mode"], "fullscreen");
    let wrong = json!({ "outputs": [{ "name": "HEADLESS-1", "vrr": "sometimes" }] });
    assert!(ipc.request("outputs-config", wrong)["error"].is_string());
}

#[test]
fn keyboard_layouts_and_pointer_settings_are_checked_then_used() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let german =
        json!({ "layout": "de", "variant": "nodeadkeys", "repeatRate": 30, "repeatDelay": 250 });
    assert_eq!(ipc.request("keyboard", german)["result"], json!({}));
    // A layout xkb does not know is refused, and the keyboard keeps the last.
    let unknown = json!({ "layout": "no-such-layout" });
    assert!(ipc.request("keyboard", unknown)["error"].is_string());
    let odd = json!({ "layout": "us; rm" });
    assert!(ipc.request("keyboard", odd)["error"].is_string());
    // Back to the system's own.
    assert_eq!(
        ipc.request("keyboard", json!({ "layout": "", "variant": "" }))["result"],
        json!({})
    );

    let input = json!({
        "touchpad": { "tap": true, "naturalScroll": true, "accelSpeed": 0.3, "clickMethod": "clickfinger", "scrollSpeed": 1.5 },
        "mouse": { "accelProfile": "flat" }
    });
    assert_eq!(ipc.request("input", input)["result"], json!({}));
    let wrong = json!({ "mouse": { "accelSpeed": 3 } });
    assert!(ipc.request("input", wrong)["error"].is_string());
}

#[test]
fn nothing_of_a_session_outlives_its_compositor() {
    let out = tempfile::tempdir().unwrap();
    let pid_file = out.path().join("pid");
    // The client starts something in the background (as the shell starts its
    // own processes), then waits.
    let command = format!("sleep 300 & echo $! > '{}'; wait", pid_file.display());
    let mut compositor = Compositor::start(&["-c", &command]);
    let start = Instant::now();
    while !pid_file.exists()
        || std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .is_empty()
    {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the client never started"
        );
        sleep(Duration::from_millis(20));
    }
    let pid: i32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let alive = |pid: i32| {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
            && !std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .unwrap_or_default()
                .contains(") Z ")
    };
    assert!(alive(pid));

    // The compositor stops (as at logout): the background process goes with it.
    rustix::process::kill_process(
        rustix::process::Pid::from_raw(compositor.child.id() as i32).unwrap(),
        rustix::process::Signal::TERM,
    )
    .unwrap();
    let _ = compositor.child.wait();
    let start = Instant::now();
    while alive(pid) {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "a session process outlived the compositor"
        );
        sleep(Duration::from_millis(20));
    }
}
