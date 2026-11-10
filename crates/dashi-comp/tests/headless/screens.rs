//! Screens: how they are described, arranged and mirrored.

use serde_json::{Value, json};

use super::fixtures::wait_event;
use crate::support::{
    client::Client,
    compositor::{Compositor, Ipc},
};

#[test]
fn screens_are_described_as_the_shell_parses_them() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    let outputs = ipc.request("outputs", json!({}))["result"]["outputs"].clone();
    let screen = &outputs[0];
    assert_eq!(screen["name"], "HEADLESS-1");
    assert_eq!(
        screen["mode"],
        json!({ "width": 1920, "height": 1080, "refreshMhz": 60000 })
    );
    assert_eq!(screen["modes"][0]["current"], true);
    assert_eq!(screen["scale"], 1.0);
    assert_eq!(
        screen["transform"],
        json!({ "rotation": 0, "flipped": false })
    );
    assert_eq!(
        screen["frame"],
        json!({ "x": 0, "y": 0, "width": 1920, "height": 1080 })
    );
    // Nothing has claimed an edge yet: all of it is usable.
    assert_eq!(screen["usable"], screen["frame"]);
    assert_eq!(screen["primary"], true);

    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    assert_eq!(
        ipc.request("output", json!({ "name": "HEADLESS-1", "scale": 2.0 }))["result"],
        json!({})
    );
    assert_eq!(ipc.events, vec![json!({ "event": "outputs-changed" })]);
    let screen = &ipc.request("outputs", json!({}))["result"]["outputs"][0];
    assert_eq!(screen["scale"], 2.0);
    assert_eq!(
        screen["frame"],
        json!({ "x": 0, "y": 0, "width": 960, "height": 540 })
    );

    assert!(
        ipc.request("output", json!({ "name": "HEADLESS-1", "scale": 9.0 }))["error"].is_string()
    );
    assert!(
        ipc.request("output", json!({ "name": "nope", "scale": 1.0 }))["error"]
            .as_str()
            .unwrap()
            .contains("nope")
    );
}

#[test]
fn screens_are_arranged_and_windows_fly_to_their_tiles() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));

    let arrangement = json!({ "outputs": [{ "name": "HEADLESS-1", "position": { "x": 100, "y": 0 }, "scale": 1.5 }], "primary": "HEADLESS-1" });
    assert_eq!(
        ipc.request("outputs-config", arrangement)["result"],
        json!({})
    );
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    assert_eq!(
        (
            screen["frame"]["x"].as_i64(),
            screen["scale"].as_f64(),
            screen["primary"].as_bool()
        ),
        (Some(100), Some(1.5), Some(true))
    );
    assert!(
        ipc.request("outputs-config", json!({ "outputs": [{ "name": "nope" }] }))["error"]
            .is_string()
    );
    assert!(
        ipc.request(
            "outputs-config",
            json!({ "outputs": [{ "name": "HEADLESS-1", "transform": { "rotation": 45 } }] })
        )["error"]
            .is_string()
    );
    let off = json!({ "outputs": [{ "name": "HEADLESS-1", "enabled": false }] });
    assert!(
        ipc.request("outputs-config", off)["error"]
            .as_str()
            .unwrap()
            .contains("stay on")
    );

    let zones = json!({ "zones": [{ "area": { "x": 0, "y": 0, "width": 2, "height": 500 }, "frame": { "x": 0, "y": 0, "width": 640, "height": 720 } }], "dwellMs": 300 });
    assert_eq!(ipc.request("layout", zones)["result"], json!({}));
    assert!(ipc.request("layout", json!({ "zones": [{ "area": {} }] }))["error"].is_string());

    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Fly");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 200, "y": 100 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    let tile = json!({ "targets": [{ "window": id, "rect": { "x": 600, "y": 1000, "width": 48, "height": 48 } }] });
    assert_eq!(ipc.request("animation-target", tile)["result"], json!({}));
    assert_eq!(
        ipc.request("minimize", json!({ "window": id }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("windows", json!({}))["result"]["windows"][0]["state"],
        "minimized"
    );
    assert_eq!(
        ipc.request("focus", json!({ "window": id }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("windows", json!({}))["result"]["windows"][0]["state"],
        "normal"
    );
}

/// The screens by name, from an `outputs` answer.
fn screen_named(ipc: &mut Ipc, name: &str) -> Value {
    let outputs = ipc.request("outputs", json!({}))["result"]["outputs"].clone();
    outputs
        .as_array()
        .and_then(|list| list.iter().find(|o| o["name"] == name).cloned())
        .unwrap_or(Value::Null)
}

#[test]
fn a_screen_mirrors_another_and_comes_back_where_it_was() {
    let compositor = Compositor::start_with(&[], &[("DASHI_HEADLESS_SCREENS", "2")]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let second = screen_named(&mut ipc, "HEADLESS-2");
    assert_eq!(
        second["frame"],
        json!({ "x": 1920, "y": 0, "width": 1280, "height": 1024 })
    );
    assert_eq!(second["mirrorOf"], Value::Null);

    // Mistakes change nothing.
    for (params, words) in [
        (
            json!({ "output": "HEADLESS-2", "source": "HEADLESS-2" }),
            "itself",
        ),
        (json!({ "output": "HEADLESS-2", "source": "nope" }), "nope"),
        (json!({ "output": "nope", "source": "HEADLESS-1" }), "nope"),
        (json!({ "source": "HEADLESS-1" }), "output"),
        (json!({ "output": "HEADLESS-2", "source": 3 }), "source"),
    ] {
        let error = ipc.request("mirror", params.clone())["error"].clone();
        assert!(
            error.as_str().is_some_and(|e| e.contains(words)),
            "{params}: {error}"
        );
    }
    assert!(ipc.events.is_empty());

    assert_eq!(
        ipc.request(
            "mirror",
            json!({ "output": "HEADLESS-2", "source": "HEADLESS-1" })
        )["result"],
        json!({})
    );
    assert_eq!(ipc.events, vec![json!({ "event": "outputs-changed" })]);
    let second = screen_named(&mut ipc, "HEADLESS-2");
    assert_eq!(second["mirrorOf"], "HEADLESS-1");
    assert_eq!(second["enabled"], true, "still on: it shows the first");
    assert_eq!(second["frame"], Value::Null, "no desktop of its own");
    assert_eq!(second["primary"], false);
    // The first can't mirror the screen that mirrors it.
    assert!(
        ipc.request(
            "mirror",
            json!({ "output": "HEADLESS-1", "source": "HEADLESS-2" })
        )["error"]
            .is_string()
    );
    ipc.events.clear();
    assert_eq!(
        ipc.request("mirror", json!({ "output": "HEADLESS-2", "source": null }))["result"],
        json!({})
    );
    assert_eq!(ipc.events, vec![json!({ "event": "outputs-changed" })]);
    let second = screen_named(&mut ipc, "HEADLESS-2");
    assert_eq!(second["mirrorOf"], Value::Null);
    assert_eq!(
        second["frame"],
        json!({ "x": 1920, "y": 0, "width": 1280, "height": 1024 })
    );
    // Stopping twice is no error.
    assert_eq!(
        ipc.request("mirror", json!({ "output": "HEADLESS-2", "source": null }))["result"],
        json!({})
    );
}

#[test]
fn an_arrangement_that_moves_a_mirroring_screen_ends_its_mirroring() {
    let compositor = Compositor::start_with(&[], &[("DASHI_HEADLESS_SCREENS", "2")]);
    let mut ipc = compositor.connect();
    ipc.request(
        "mirror",
        json!({ "output": "HEADLESS-2", "source": "HEADLESS-1" }),
    );
    // A scale alone leaves it mirroring.
    assert_eq!(
        ipc.request(
            "outputs-config",
            json!({ "outputs": [{ "name": "HEADLESS-2", "scale": 1.0 }] })
        )["result"],
        json!({})
    );
    assert_eq!(
        screen_named(&mut ipc, "HEADLESS-2")["mirrorOf"],
        "HEADLESS-1"
    );
    assert_eq!(
        ipc.request(
            "outputs-config",
            json!({ "outputs": [{ "name": "HEADLESS-2", "position": { "x": 0, "y": 1080 } }] })
        )["result"],
        json!({})
    );
    let second = screen_named(&mut ipc, "HEADLESS-2");
    assert_eq!(second["mirrorOf"], Value::Null);
    assert_eq!(second["frame"]["y"], 1080);
}
