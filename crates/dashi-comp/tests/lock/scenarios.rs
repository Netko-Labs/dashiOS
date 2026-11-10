//! The scenarios the session client plays, one for each way something could
//! take the keyboard while the screen is locked.

use std::{thread::sleep, time::Duration};

use serde_json::json;

use super::ipc::wait_until;
use super::session::Locked;
use crate::support::shell_client::KEY_A;

pub(super) fn play(name: &str) {
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
