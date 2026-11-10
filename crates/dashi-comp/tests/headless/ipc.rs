//! The IPC socket: what the shell may ask, what it is told when it asks wrong, and who may connect.

use std::{io::Write, time::Duration};

use serde_json::json;

use crate::support::compositor::Compositor;

#[test]
fn the_shell_can_ask() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));

    let session = &ipc.request("session", json!({}))["result"];
    assert!(
        session["waylandDisplay"]
            .as_str()
            .is_some_and(|name| name.starts_with("wayland-"))
    );
    assert_eq!(session["xwayland"], "off");
    assert!(session["pointer"]["x"].is_number());

    assert_eq!(
        ipc.request("windows", json!({}))["result"],
        json!({ "windows": [] })
    );
}

#[test]
fn mistakes_get_errors_not_a_dropped_connection() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    assert!(
        ipc.request("frobnicate", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("unknown method")
    );
    assert!(
        ipc.request("agent-input", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("window id")
    );
    assert_eq!(
        ipc.request("focus", json!({ "window": 1 }))["error"],
        "no window 1"
    );
    assert!(
        ipc.request("focus", json!({ "window": "1" }))["error"]
            .as_str()
            .unwrap()
            .contains("window id")
    );
    assert!(
        ipc.request(
            "frame",
            json!({ "window": 1, "x": 0, "y": 0, "width": 0, "height": 10 })
        )["error"]
            .is_string()
    );
    assert_eq!(
        ipc.line(r#"{"id":40,"method":"windows","params":[1]}"#)["id"],
        40
    );
    // A line that is not a request at all is dropped; the connection still answers.
    writeln!(ipc.stream, "not json").unwrap();
    assert!(ipc.request("windows", json!({}))["result"]["windows"].is_array());
}

/// What docs/compositor-ipc.md says each method is: (name, who).
fn documented_methods() -> Vec<(String, String)> {
    let doc = include_str!("../../../../docs/compositor-ipc.md");
    let requests = doc.split("\n## Requests\n").nth(1).unwrap();
    let requests = requests.split("\n## ").next().unwrap();
    requests
        .lines()
        .filter_map(|line| {
            let mut cells = line.split(" | ");
            let name = cells.next()?.strip_prefix("| `")?.strip_suffix('`')?;
            Some((name.to_owned(), cells.next()?.trim().to_owned()))
        })
        .collect()
}

#[test]
fn a_program_that_is_not_the_shell_is_refused() {
    // The session client is `sleep`; this test is not under it.
    let compositor = Compositor::start_session("exec sleep 60");
    let mut ipc = compositor.connect();
    let methods = documented_methods();
    assert!(methods.len() > 50, "the doc lists the methods");
    for (name, who) in &methods {
        let reply = ipc.request(name, json!({}));
        let error = reply["error"].as_str().unwrap_or_default();
        match who.as_str() {
            "shell" => assert_eq!(error, format!("{name} is only for the shell"), "{name}"),
            "granted" => assert_eq!(
                error,
                format!("{name} is only for the shell and what it grants it to"),
                "{name}"
            ),
            "anyone" => assert!(!error.contains("only for"), "{name}: {reply}"),
            other => panic!("{name}: who is {other:?}"),
        }
    }
    assert_eq!(
        ipc.request("frobnicate", json!({}))["error"],
        "unknown method: frobnicate"
    );
    // The screens are anyone's to read.
    assert!(ipc.request("outputs", json!({}))["result"].is_object());
}

#[test]
fn a_connection_dropped_for_falling_behind_runs_nothing_more() {
    let compositor = Compositor::start(&[]);
    let mut other = compositor.connect();
    let flooded = compositor.connect();
    // Ask and never read: its replies pile up past the backlog, and it is dropped.
    // The Spaces asked for after that must not be added.
    let mut lines = String::new();
    for id in 0..200_000 {
        lines.push_str(&format!("{{\"id\":{id},\"method\":\"outputs\"}}\n"));
    }
    for id in 0..5 {
        lines.push_str(&format!(
            "{{\"id\":{},\"method\":\"space-add\"}}\n",
            300_000 + id
        ));
    }
    let mut writer = flooded.stream.try_clone().unwrap();
    let wrote = std::thread::spawn(move || writer.write_all(lines.as_bytes()).is_ok());
    assert!(!wrote.join().unwrap(), "the compositor stopped reading it");
    // It hears the end of the stream.
    let mut reader = flooded.stream.try_clone().unwrap();
    reader
        .set_read_timeout(Some(Duration::from_secs(20)))
        .unwrap();
    let mut sink = vec![0u8; 1 << 16];
    loop {
        match std::io::Read::read(&mut reader, &mut sink) {
            Ok(0) => break,
            Ok(_) => {}
            // Closed with requests of its still unread: a reset.
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => break,
            Err(error) => panic!("no end of stream: {error}"),
        }
    }
    assert_eq!(
        other.request("spaces", json!({}))["result"]["count"],
        1,
        "nothing it sent after the drop was run"
    );
}
