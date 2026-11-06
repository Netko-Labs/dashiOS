//! While the screen is locked, keys reach the lock screen and nothing else,
//! whatever asks for the keyboard. Each test runs the real compositor
//! headless with this test binary as its session client (`-c`), so that side
//! is the shell: it may lock, open sheets, and type on a virtual keyboard. A
//! window stands in for System Settings (the window behind the lock screen
//! that got "test-dashi" in the 0.5.0 review); after each way something
//! could take the keyboard, a key is typed and must reach the lock screen,
//! and the window must never get the keyboard back until the unlock.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    process::Command,
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

mod support {
    pub mod shell_client;
}
use support::shell_client::{Conn, KEY_A};

/// Which scenario the session client plays, and where it writes how it went.
const SCENARIO: &str = "DASHI_LOCK_SCENARIO";
const RESULT: &str = "DASHI_LOCK_RESULT";

/// Not a test of its own: the shell side of the tests below, run by the
/// compositor as its session client. Run any other way, it passes at once.
#[test]
fn lock_scenario() {
    let Ok(name) = std::env::var(SCENARIO) else {
        return;
    };
    let result = PathBuf::from(std::env::var(RESULT).expect("a result path"));
    let outcome = std::panic::catch_unwind(|| play(&name));
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

/// Run `scenario` as the compositor's session client and check it went through.
fn run(scenario: &str) {
    let dir = tempfile::tempdir().expect("a temporary runtime folder");
    let result = dir.path().join("result");
    let exe = std::env::current_exe().expect("this test binary");
    let command = format!(
        "exec '{}' --exact lock_scenario --nocapture --test-threads=1 >/dev/null",
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
        .env(SCENARIO, scenario)
        .env(RESULT, &result)
        .spawn()
        .expect("dashi-comp starts");
    let start = Instant::now();
    while child.try_wait().expect("the compositor").is_none() {
        if start.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("{scenario}: the session did not end");
        }
        sleep(Duration::from_millis(20));
    }
    let said = std::fs::read_to_string(&result).unwrap_or_else(|_| "no result written".into());
    assert_eq!(said, "ok", "{scenario}");
}

/// The compositor's IPC, as the shell speaks it (no `subscribe`: windows place themselves).
struct Ipc {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    next: u64,
}

impl Ipc {
    fn connect() -> Self {
        let path = std::env::var("DASHI_COMP_SOCKET").expect("the compositor's socket");
        let stream = UnixStream::connect(path).expect("the IPC socket answers");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Self {
            reader: BufReader::new(stream.try_clone().unwrap()),
            stream,
            next: 0,
        }
    }

    /// The reply: `{result}` or `{error}`.
    fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let line = json!({ "id": self.next, "method": method, "params": params });
        writeln!(self.stream, "{line}").unwrap();
        loop {
            let mut line = String::new();
            self.reader.read_line(&mut line).expect("a reply");
            let message: Value = serde_json::from_str(&line).expect("JSON");
            if message.get("event").is_none() {
                return message;
            }
        }
    }

    fn refused(&mut self, method: &str, params: Value) -> String {
        let reply = self.request(method, params);
        reply["error"]
            .as_str()
            .unwrap_or_else(|| panic!("{method} was not refused: {reply}"))
            .to_owned()
    }

    fn window_id(&mut self, app_id: &str) -> u64 {
        let windows = self.request("windows", json!({}))["result"]["windows"].clone();
        windows
            .as_array()
            .and_then(|all| all.iter().find(|w| w["appId"] == app_id))
            .and_then(|w| w["id"].as_u64())
            .unwrap_or_else(|| panic!("no window of {app_id}: {windows}"))
    }
}

/// Roundtrip `conns` until `done` holds.
fn wait_until(conns: &mut [&mut Conn], what: &str, done: impl Fn(&[&mut Conn]) -> bool) {
    let start = Instant::now();
    while !done(conns) {
        assert!(start.elapsed() < Duration::from_secs(10), "never: {what}");
        for conn in conns.iter_mut() {
            conn.roundtrip();
        }
        sleep(Duration::from_millis(10));
    }
}

/// The session as the review had it: Settings' window with the keyboard, then locked.
struct Locked {
    ipc: Ipc,
    settings: Conn,
    lock: Conn,
    typist: Conn,
    runtime: PathBuf,
    display: String,
}

impl Locked {
    fn new() -> Self {
        let mut ipc = Ipc::connect();
        let runtime = PathBuf::from(std::env::var("XDG_RUNTIME_DIR").unwrap());
        let display = std::env::var("WAYLAND_DISPLAY").unwrap();
        let mut settings = Conn::connect(&runtime, &display);
        settings.window("dev.dashi.settings", "System Settings");
        wait_until(&mut [&mut settings], "Settings has the keyboard", |c| {
            c[0].state.focused
        });
        let mut typist = Conn::connect(&runtime, &display);
        typist.type_key(KEY_A);
        settings.roundtrip();
        assert_eq!(
            settings.state.keys,
            [KEY_A],
            "Settings types before the lock"
        );
        settings.state.keys.clear();

        let mut lock = Conn::connect(&runtime, &display);
        lock.lock();
        settings.roundtrip();
        assert!(!settings.state.focused, "locking takes the keyboard away");
        assert_eq!(ipc.request("session", json!({}))["result"]["locked"], true);
        lock.lock_surface();
        wait_until(&mut [&mut lock], "the lock screen has the keyboard", |c| {
            c[0].state.focused
        });
        let mut locked = Self {
            ipc,
            settings,
            lock,
            typist,
            runtime,
            display,
        };
        locked.typed_on_lock_screen("after locking");
        locked
    }

    fn conn(&self) -> Conn {
        Conn::connect(&self.runtime, &self.display)
    }

    /// A key typed now reaches the lock screen, and Settings neither gets it nor the keyboard.
    fn typed_on_lock_screen(&mut self, after: &str) {
        let enters = self.settings.state.enters;
        self.lock.state.keys.clear();
        self.typist.type_key(KEY_A);
        self.lock.roundtrip();
        self.settings.roundtrip();
        assert_eq!(
            self.lock.state.keys,
            [KEY_A],
            "{after}: the lock screen got the key"
        );
        self.no_key_reached_settings(after, enters);
        assert!(
            self.lock.state.focused,
            "{after}: the lock screen has the keyboard"
        );
    }

    fn no_key_reached_settings(&mut self, after: &str, enters: usize) {
        self.settings.roundtrip();
        assert!(
            self.settings.state.keys.is_empty(),
            "{after}: Settings got keys {:?}",
            self.settings.state.keys
        );
        assert!(
            !self.settings.state.focused,
            "{after}: Settings has the keyboard"
        );
        assert_eq!(
            self.settings.state.enters, enters,
            "{after}: Settings got the keyboard"
        );
    }

    /// Unlock: the window in front gets the keyboard back.
    fn unlock(&mut self) {
        self.lock.unlock();
        assert_eq!(
            self.ipc.request("session", json!({}))["result"]["locked"],
            false
        );
    }
}

fn play(name: &str) {
    let mut s = Locked::new();
    let settings = s.ipc.window_id("dev.dashi.settings");
    match name {
        "focus" => {
            // The shell brings a window forward (the Dock, an app's own open(), an agent before the lock).
            assert_eq!(
                s.ipc.request("focus", json!({ "window": settings }))["result"],
                json!({})
            );
            s.typed_on_lock_screen("focus");
            s.unlock();
            wait_until(
                &mut [&mut s.settings],
                "Settings has the keyboard after the unlock",
                |c| c[0].state.focused,
            );
        }
        "typing" => {
            // Nothing types into a window while locked: send-keys (❖ chords, pastes), a snippet's erase.
            let error = s.ipc.refused(
                "send-keys",
                json!({ "window": settings, "chord": "ctrl+a" }),
            );
            assert!(error.contains("locked"), "{error}");
            let error = s.ipc.refused(
                "snippet-erase",
                json!({ "window": settings, "keyword": "a" }),
            );
            assert!(error.contains("locked"), "{error}");
            let error = s.ipc.refused(
                "agent-input",
                json!({ "window": settings, "keys": [{ "text": "a" }] }),
            );
            assert!(error.contains("locked"), "{error}");
            // The overview would take the lock screen's presses.
            let error = s.ipc.refused("overview", json!({ "windows": [] }));
            assert!(error.contains("locked"), "{error}");
            s.typed_on_lock_screen("send-keys");
        }
        "new-window" => {
            // A window that opens while locked (a portal's dialog, an app starting) waits for the unlock.
            let mut dialog = s.conn();
            dialog.window("dev.dashi.dialog", "Access");
            wait_until(&mut [&mut dialog], "the dialog is placed", |c| {
                c[0].state.shown
            });
            s.ipc.window_id("dev.dashi.dialog");
            dialog.roundtrip();
            s.typed_on_lock_screen("a window opened");
            assert!(
                dialog.state.keys.is_empty() && !dialog.state.focused,
                "the dialog got the keyboard"
            );
            // Closed with Esc, say: the window under it does not get the keyboard either.
            dialog.close_window();
            s.typed_on_lock_screen("the new window closed");
        }
        "sheet" => {
            // A shell sheet that takes the keyboard (the launcher after a ❖ tap, a Wi-Fi password)
            // comes up while locked, then closes: the window under it is not handed the keyboard.
            let mut sheet = s.conn();
            sheet.sheet(true);
            assert!(sheet.state.layer_shown, "the sheet was configured");
            s.typed_on_lock_screen("a sheet that takes the keyboard");
            assert!(
                sheet.state.keys.is_empty() && !sheet.state.focused,
                "the sheet got the keyboard"
            );
            sheet.close_sheet();
            s.typed_on_lock_screen("the sheet closed");
            // One still up at the unlock gets the keyboard then, not the window.
            let mut second = s.conn();
            second.sheet(true);
            s.unlock();
            wait_until(
                &mut [&mut second],
                "the sheet has the keyboard after the unlock",
                |c| c[0].state.focused,
            );
            s.settings.roundtrip();
            assert!(!s.settings.state.focused);
        }
        "activation" => {
            // An app asks for the keyboard with a token that names no surface (xdg-activation).
            s.settings.activate_self();
            s.typed_on_lock_screen("xdg-activation");
        }
        "space" => {
            // A Space switch gives its front window the keyboard.
            assert!(s.ipc.request("space-add", json!({}))["result"].is_object());
            for space in [1, 0] {
                let reply = s.ipc.request("space-switch", json!({ "space": space }));
                assert!(reply["error"].is_null(), "{reply}");
                // The slide ends, and with it the keyboard goes to the Space's front window.
                sleep(Duration::from_millis(800));
            }
            s.typed_on_lock_screen("a Space switch");
            assert_eq!(
                s.ipc.request("minimize", json!({ "window": settings }))["result"],
                json!({})
            );
            assert_eq!(
                s.ipc.request("focus", json!({ "window": settings }))["result"],
                json!({})
            );
            s.typed_on_lock_screen("minimize and focus");
        }
        "lock-screen-dies" => {
            // The lock screen's client dies (a crash): the session stays locked, keys go nowhere,
            // and the next lock screen (the shell starts one) gets them.
            let enters = s.settings.state.enters;
            let stand_in = s.conn();
            drop(std::mem::replace(&mut s.lock, stand_in));
            s.typist.type_key(KEY_A);
            s.no_key_reached_settings("the lock screen died", enters);
            assert_eq!(
                s.ipc.request("session", json!({}))["result"]["locked"],
                true
            );
            assert_eq!(
                s.ipc.request("focus", json!({ "window": settings }))["result"],
                json!({})
            );
            s.typist.type_key(KEY_A);
            s.no_key_reached_settings("focus with no lock screen", enters);
            let mut next = s.conn();
            next.lock();
            next.lock_surface();
            wait_until(
                &mut [&mut next],
                "the new lock screen has the keyboard",
                |c| c[0].state.focused,
            );
            s.lock = next;
            s.typed_on_lock_screen("a new lock screen");
        }
        other => panic!("no scenario {other}"),
    }
}

#[test]
fn a_window_the_shell_focuses_while_locked_gets_no_keys() {
    run("focus");
}

#[test]
fn nothing_types_into_a_window_while_locked() {
    run("typing");
}

#[test]
fn a_window_that_opens_or_closes_while_locked_gets_no_keys() {
    run("new-window");
}

#[test]
fn a_sheet_that_takes_the_keyboard_waits_for_the_unlock() {
    run("sheet");
}

#[test]
fn an_app_activating_itself_while_locked_gets_no_keys() {
    run("activation");
}

#[test]
fn spaces_and_minimizing_while_locked_move_no_keys() {
    run("space");
}

#[test]
fn a_lock_screen_that_dies_leaves_the_keys_with_nobody() {
    run("lock-screen-dies");
}
