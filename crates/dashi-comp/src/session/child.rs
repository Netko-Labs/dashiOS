//! The session's client (`-c COMMAND`): run through `sh -c`, with the
//! compositor's Wayland and IPC sockets in its environment. When it exits, so
//! does the compositor: the session is over. And the other way round: the
//! client runs in a process group of its own, which `end_session` ends when
//! the compositor stops, and the client hears SIGTERM if the compositor dies
//! outright; nothing of an old session lingers to open surfaces on the next
//! one (which reuses the socket names).

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
    x_display: Option<&str>,
    ipc_socket: &Path,
    handle: &LoopHandle<'static, Dashi>,
) -> Result<u32, Box<dyn std::error::Error>> {
    let mut command_line = Command::new("/bin/sh");
    command_line
        .arg("-c")
        .arg(command)
        .env("WAYLAND_DISPLAY", wayland_display)
        .env("DASHI_COMP_SOCKET", ipc_socket)
        // A client of this compositor, not of whatever it is nested in.
        .env_remove("DISPLAY");
    if let Some(x_display) = x_display {
        command_line.env("DISPLAY", x_display);
    }
    // Its own process group, so the whole session can be ended at once.
    std::os::unix::process::CommandExt::process_group(&mut command_line, 0);
    // SAFETY: only async-signal-safe calls (sigprocmask, prctl) run between fork and exec.
    unsafe {
        std::os::unix::process::CommandExt::pre_exec(&mut command_line, || {
            unblock_signals()?;
            rustix::process::set_parent_process_death_signal(Some(rustix::process::Signal::TERM))
                .map_err(std::io::Error::from)
        });
    }
    let mut child = command_line.spawn()?;
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

/// The compositor is stopping: end the session client and all it started.
pub(crate) fn end_session(pid: i32) {
    let Some(group) = rustix::process::Pid::from_raw(pid) else {
        return;
    };
    match rustix::process::kill_process_group(group, rustix::process::Signal::TERM) {
        Ok(()) => tracing::info!(pid, "ended the session's processes"),
        // Already gone: nothing to end.
        Err(rustix::io::Errno::SRCH) => {}
        Err(error) => tracing::warn!(pid, %error, "could not end the session's processes"),
    }
}

/// The compositor blocks SIGTERM and SIGINT to take them as events (main.rs);
/// the session must not inherit that, or it could not be ended.
fn unblock_signals() -> std::io::Result<()> {
    // SAFETY: a zeroed sigset_t is a valid argument to sigemptyset, which
    // initializes it; the calls only read and write this local set.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        if libc::pthread_sigmask(libc::SIG_UNBLOCK, &set, std::ptr::null_mut()) != 0 {
            return Err(std::io::Error::last_os_error());
        }
    }
    Ok(())
}
