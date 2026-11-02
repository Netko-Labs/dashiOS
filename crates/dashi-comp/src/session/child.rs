//! The session's client (`-c COMMAND`): run through `sh -c`, with the
//! compositor's Wayland and IPC sockets in its environment. When it exits, so
//! does the compositor: the session is over.

use std::{
    ffi::OsString,
    path::Path,
    process::{Command, ExitStatus},
};

use smithay::reexports::calloop::{
    LoopHandle,
    channel::{self, Event},
};

use crate::state::Dashi;

pub(crate) fn spawn(
    command: &str,
    wayland_display: &OsString,
    ipc_socket: &Path,
    handle: &LoopHandle<'static, Dashi>,
) -> Result<u32, Box<dyn std::error::Error>> {
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg(command)
        .env("WAYLAND_DISPLAY", wayland_display)
        .env("DASHI_COMP_SOCKET", ipc_socket)
        // A client of this compositor, not of whatever it is nested in.
        .env_remove("DISPLAY")
        .spawn()?;
    let pid = child.id();
    tracing::info!(pid, command, "session client started");

    let (sender, receiver) = channel::channel::<std::io::Result<ExitStatus>>();
    std::thread::Builder::new()
        .name("session-client".into())
        .spawn(move || {
            let _ = sender.send(child.wait());
        })?;
    handle.insert_source(receiver, move |event, _, state| {
        if let Event::Msg(status) = event {
            match status {
                Ok(status) => {
                    tracing::info!(pid, %status, "session client exited; ending the session")
                }
                Err(error) => {
                    tracing::warn!(pid, %error, "lost the session client; ending the session")
                }
            }
            state.loop_signal.stop();
        }
    })?;
    Ok(pid)
}
