//! The session as the review had it, ready for a scenario to play.

use std::path::PathBuf;

use serde_json::json;

use super::ipc::{Ipc, wait_until};
use crate::support::shell_client::{Conn, KEY_A};

/// The session as the review had it: Settings' window with the keyboard, then locked.
pub(super) struct Locked {
    pub(super) ipc: Ipc,
    pub(super) settings: Conn,
    pub(super) lock: Conn,
    pub(super) typist: Conn,
    pub(super) runtime: PathBuf,
    pub(super) display: String,
}

impl Locked {
    pub(super) fn new() -> Self {
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

    pub(super) fn conn(&self) -> Conn {
        Conn::connect(&self.runtime, &self.display)
    }

    /// A key typed now reaches the lock screen, and Settings neither gets it nor the keyboard.
    pub(super) fn typed_on_lock_screen(&mut self, after: &str) {
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

    pub(super) fn no_key_reached_settings(&mut self, after: &str, enters: usize) {
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
    pub(super) fn unlock(&mut self) {
        self.lock.unlock();
        assert_eq!(
            self.ipc.request("session", json!({}))["result"]["locked"],
            false
        );
    }
}
