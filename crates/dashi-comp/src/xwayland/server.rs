//! Starting Xwayland on a display known at once, and starting it again
//! (backing off) when it fails.

use std::{process::Stdio, time::Duration};

use serde_json::json;
use smithay::{
    reexports::calloop::timer::{TimeoutAction, Timer},
    xwayland::{X11Wm, XWayland, XWaylandEvent},
};

use crate::state::Dashi;

use super::{RESTART_AFTER, XState};

impl Dashi {
    /// Start Xwayland; when it is ready the shell hears `session-changed`.
    pub(crate) fn start_xwayland(&mut self) {
        // The same display number after a restart, so apps' DISPLAY stays right.
        let spawned = XWayland::spawn(
            &self.display_handle,
            self.xwayland.number,
            std::iter::empty::<(String, String)>(),
            true,
            Stdio::null(),
            Stdio::null(),
            |_| (),
        );
        let (xwayland, client) = match spawned {
            Ok(spawned) => spawned,
            Err(error) => {
                tracing::warn!(%error, "Xwayland did not start; X11 apps will not run");
                self.xwayland.state = XState::Failed;
                return;
            }
        };
        self.xwayland.state = XState::Starting;
        // Before Xwayland binds the outputs, so it sees them at its scale.
        self.xwayland.client = Some(client.clone());
        self.apply_xwayland_scale();
        // The socket is listening already: X clients may connect before it is ready.
        self.xwayland.number = Some(xwayland.display_number());
        self.xwayland.display = self.xwayland.number;
        let inserted =
            self.loop_handle
                .insert_source(xwayland, move |event, _, state| match event {
                    XWaylandEvent::Ready {
                        x11_socket,
                        display_number,
                    } => {
                        match X11Wm::start_wm(state.loop_handle.clone(), x11_socket, client.clone())
                        {
                            Ok(wm) => {
                                state.xwayland.wm = Some(wm);
                                state.xwayland.display = Some(display_number);
                                state.xwayland.state = XState::Ready;
                                state.xwayland.restarts = 0;
                                state.listen_x11_activation(display_number);
                                tracing::info!(display = display_number, "Xwayland is ready");
                            }
                            Err(error) => {
                                tracing::warn!(%error, "no X11 window manager");
                                state.xwayland.state = XState::Failed;
                            }
                        }
                        state.ipc.emit("session-changed", json!({}));
                    }
                    XWaylandEvent::Error => {
                        tracing::warn!("Xwayland stopped");
                        state.xwayland_gone();
                    }
                });
        if inserted.is_err() {
            self.xwayland.state = XState::Failed;
        }
    }

    /// Xwayland died: say so, and start it again a little later.
    fn xwayland_gone(&mut self) {
        self.xwayland.wm = None;
        self.xwayland.client = None;
        self.xwayland.display = None;
        self.xwayland.state = XState::Failed;
        self.ipc.emit("session-changed", json!({}));
        let wait = RESTART_AFTER[self.xwayland.restarts.min(RESTART_AFTER.len() - 1)];
        self.xwayland.restarts += 1;
        let _ = self.loop_handle.insert_source(
            Timer::from_duration(Duration::from_secs(wait)),
            |_, _, state| {
                if state.xwayland.state == XState::Failed {
                    state.start_xwayland();
                }
                TimeoutAction::Drop
            },
        );
    }
}
