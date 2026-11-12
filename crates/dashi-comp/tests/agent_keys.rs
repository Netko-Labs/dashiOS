//! An agent's keys go to the window it named, never through the person's
//! input method, even while one holds the keyboard (session/agent_keys.rs).
//! In Helium with fcitx5, a click then `type_text` lost up to 14 of 50 keys
//! while the input method caught up with the field's focus
//! (dashi-0.5.0-review/56-helium-typing). The compositor runs headless with
//! this test binary as its session client (`-c`), so this side is the shell
//! and may be an input method, as fcitx5 is, the shell's child.
// Tests may unwrap and touch files (H12 covers the compositor, not its tests).
#![allow(clippy::unwrap_used, clippy::disallowed_methods)]

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    process::Command,
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

#[allow(dead_code)] // The lock tests use the rest.
mod support {
    pub mod shell_client;
}
use support::shell_client::{Conn, KEY_A};

const SCENARIO: &str = "DASHI_AGENT_KEYS_SCENARIO";
const RESULT: &str = "DASHI_AGENT_KEYS_RESULT";
/// evdev KEY_B, KEY_ENTER and KEY_LEFTSHIFT.
const KEY_B: u32 = 48;
const KEY_ENTER: u32 = 28;
const KEY_LEFTSHIFT: u32 = 42;

/// Not a test of its own: the shell side of the test below, run by the
/// compositor as its session client. Run any other way, it passes at once.
#[test]
fn agent_keys_scenario() {
    if std::env::var(SCENARIO).is_err() {
        return;
    }
    let result = PathBuf::from(std::env::var(RESULT).expect("a result path"));
    let outcome = std::panic::catch_unwind(play);
    let text = match outcome {
        Ok(()) => "ok".to_owned(),
        Err(panic) => panic
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_else(|| "panicked".into()),
    };
    std::fs::write(result, text).expect("the result is written");
}

#[test]
fn an_agents_keys_pass_the_persons_input_method() {
    let dir = tempfile::tempdir().expect("a temporary runtime folder");
    let result = dir.path().join("result");
    let exe = std::env::current_exe().expect("this test binary");
    let command = format!(
        "exec '{}' --exact agent_keys_scenario --nocapture --test-threads=1 >/dev/null",
        exe.display()
    );
    let mut child = Command::new(env!("CARGO_BIN_EXE_dashi-comp"))
        .args(["--backend", "headless", "-c", &command])
        .env("XDG_RUNTIME_DIR", dir.path())
        .env_remove("WAYLAND_DISPLAY")
        .env_remove("DISPLAY")
        .env_remove("DASHI_COMP_SOCKET")
        .env_remove("DASHI_AGENT_SEAT")
        .env("RUST_LOG", "warn")
        .env(SCENARIO, "1")
        .env(RESULT, &result)
        .spawn()
        .expect("dashi-comp starts");
    let start = Instant::now();
    while child.try_wait().expect("the compositor").is_none() {
        if start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("the session did not end");
        }
        sleep(Duration::from_millis(20));
    }
    let said = std::fs::read_to_string(&result).unwrap_or_else(|_| "no result written".into());
    assert_eq!(said, "ok");
}

/// One request on the compositor's IPC, as the shell sends it; its `{result}` or `{error}`.
fn request(stream: &mut UnixStream, method: &str, params: Value) -> Value {
    writeln!(
        stream,
        "{}",
        json!({ "id": 1, "method": method, "params": params })
    )
    .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("a reply");
        let message: Value = serde_json::from_str(&line).expect("JSON");
        if message.get("event").is_none() {
            return message;
        }
    }
}

fn play() {
    let path = std::env::var("DASHI_COMP_SOCKET").expect("the compositor's socket");
    let mut ipc = UnixStream::connect(path).expect("the IPC socket answers");
    ipc.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    let runtime = PathBuf::from(std::env::var("XDG_RUNTIME_DIR").unwrap());
    let display = std::env::var("WAYLAND_DISPLAY").unwrap();

    let mut window = Conn::connect(&runtime, &display);
    window.window("net.imput.helium", "Helium");
    let start = Instant::now();
    while !window.state.focused {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the window never got the keyboard"
        );
        window.roundtrip();
        sleep(Duration::from_millis(10));
    }
    let windows = request(&mut ipc, "windows", json!({}))["result"]["windows"].clone();
    let id = windows[0]["id"].as_u64().expect("the window's id");

    // A field is active: the person's input method holds the keyboard.
    let mut method = Conn::connect(&runtime, &display);
    method.grab_keyboard_as_input_method();

    // The agent borrows the person's seat (Helium hears only it) and types.
    let typed = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 0 },
        "keys": [{ "text": "aB" }, { "name": "a" }],
    });
    assert_eq!(request(&mut ipc, "agent-input", typed)["result"], json!({}));
    window.roundtrip();
    method.roundtrip();
    assert_eq!(
        window.state.keys,
        [KEY_A, KEY_LEFTSHIFT, KEY_B, KEY_A],
        "every key reaches the window, in order"
    );
    assert!(
        method.state.input_method_keys.is_empty(),
        "the input method heard the agent's keys: {:?}",
        method.state.input_method_keys
    );
    assert!(window.state.focused, "the window kept the keyboard");

    // A newline in the text is the Return key, as the tool says (it was a key no layout has).
    window.state.keys.clear();
    let lines = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 0 },
        "keys": [{ "text": "a\nb" }],
    });
    assert_eq!(request(&mut ipc, "agent-input", lines)["result"], json!({}));
    window.roundtrip();
    assert_eq!(
        window.state.keys,
        [KEY_A, KEY_ENTER, KEY_B],
        "a newline presses Return"
    );

    // Text the layout can't type is refused whole: no key of it is pressed.
    window.state.keys.clear();
    let beyond = json!({
        "window": id, "label": "Claude", "borrow": { "idleMs": 0 },
        "keys": [{ "text": "a\u{4f60}b" }],
    });
    let refused = request(&mut ipc, "agent-input", beyond);
    assert!(
        refused["error"].to_string().contains("can't type"),
        "refused: {refused}"
    );
    window.roundtrip();
    assert!(window.state.keys.is_empty(), "nothing was typed");
}
