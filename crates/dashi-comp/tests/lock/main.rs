//! While the screen is locked, keys reach the lock screen and nothing else,
//! whatever asks for the keyboard. Each test runs the real compositor
//! headless with this test binary as its session client (`-c`), so that side
//! is the shell: it may lock, open sheets, and type on a virtual keyboard. A
//! window stands in for System Settings (the window behind the lock screen
//! that got "test-dashi" in the 0.5.0 review); after each way something
//! could take the keyboard, a key is typed and must reach the lock screen,
//! and the window must never get the keyboard back until the unlock.
// Tests may unwrap and touch files (H12 covers the compositor, not its tests).
#![allow(clippy::unwrap_used, clippy::disallowed_methods)]

use std::{
    path::PathBuf,
    process::Command,
    thread::sleep,
    time::{Duration, Instant},
};

mod ipc;
mod scenarios;
mod session;

#[path = "../support"]
mod support {
    pub mod shell_client;
}
use scenarios::play;

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
