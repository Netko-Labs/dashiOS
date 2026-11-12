//! The process on a socket's other end, held: its pid (SO_PEERCRED) with a
//! pidfd for it (SO_PEERPIDFD, else pidfd_open). A pid alone names whoever
//! has it now; a client's connection can outlive the process that made it (a
//! child keeps the socket), and its pid then goes to someone else, the
//! shell's next helper perhaps. So what is asked of the pid is asked while
//! the pidfd still says that process lives. The IPC asks once, as a
//! connection is accepted (ipc/peer.rs); a Wayland client is asked each time a
//! privileged protocol looks at it (session/trust.rs), so it keeps its pidfd.

use std::{
    os::{
        fd::{AsFd, AsRawFd, FromRawFd, OwnedFd},
        unix::net::UnixStream,
    },
    path::Path,
};

/// SO_PEERPIDFD, Linux 6.5 (not in every libc crate yet).
const SO_PEERPIDFD: libc::c_int = 77;

/// A socket's peer process.
#[derive(Debug)]
pub(crate) struct Held {
    pid: i32,
    pidfd: OwnedFd,
}

impl Held {
    /// The process on the other end of `stream`; None when the kernel names none, or
    /// it can't be held (gone already).
    pub(crate) fn peer_of(stream: &UnixStream) -> Option<Self> {
        let pid = peer_pid(stream)?;
        let pidfd = peer_pidfd(stream, pid)?;
        Some(Self { pid, pidfd })
    }

    /// Its pid, while it lives: None once it is gone, for its pid may be another's now.
    pub(crate) fn pid(&self) -> Option<i32> {
        (pidfd_pid(&self.pidfd) == Some(self.pid)).then_some(self.pid)
    }

    /// Whether `holds` is true of this process: asked of its pid (in /proc, say), then the
    /// pidfd is asked whether the pid was still its own, so a pid reused meanwhile can't pass.
    pub(crate) fn is(&self, holds: impl FnOnce(i32) -> bool) -> bool {
        holds(self.pid) && self.pid().is_some()
    }
}

/// The pid of `stream`'s peer, when the kernel says (not held: a name only).
pub(crate) fn peer_pid(stream: &UnixStream) -> Option<i32> {
    rustix::net::sockopt::socket_peercred(stream)
        .ok()
        .map(|cred| cred.pid.as_raw_nonzero().get())
}

fn peer_pidfd(stream: &UnixStream, pid: i32) -> Option<OwnedFd> {
    let mut pidfd: libc::c_int = -1;
    let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `pidfd` and `len` are valid for writes of an int, and the fd is a
    // socket the caller holds open.
    let rc = unsafe {
        libc::getsockopt(
            stream.as_fd().as_raw_fd(),
            libc::SOL_SOCKET,
            SO_PEERPIDFD,
            (&mut pidfd as *mut libc::c_int).cast(),
            &mut len,
        )
    };
    if rc == 0 && pidfd >= 0 {
        // SAFETY: the kernel just gave us this fd; nothing else owns it.
        return Some(unsafe { OwnedFd::from_raw_fd(pidfd) });
    }
    // Older kernels: one opened by pid, checked against the pid all the same.
    rustix::process::pidfd_open(
        rustix::process::Pid::from_raw(pid)?,
        rustix::process::PidfdFlags::empty(),
    )
    .ok()
}

/// The pid a pidfd refers to, from /proc/self/fdinfo (-1 once it exited).
fn pidfd_pid(pidfd: &OwnedFd) -> Option<i32> {
    let info =
        std::fs::read_to_string(Path::new("/proc/self/fdinfo").join(pidfd.as_raw_fd().to_string()))
            .ok()?;
    info.lines()
        .find_map(|line| line.strip_prefix("Pid:"))
        .and_then(|pid| pid.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use std::process::{Command, Stdio};

    use super::*;

    #[test]
    fn a_peer_is_held_by_its_pidfd() {
        let (a, _b) = UnixStream::pair().unwrap();
        let me = std::process::id() as i32;
        let held = Held::peer_of(&a).unwrap();
        assert_eq!(held.pid(), Some(me));
        assert!(held.is(|pid| pid == me));
        assert!(!held.is(|_| false));
    }

    #[test]
    fn a_process_that_is_gone_is_no_longer_its_pid() {
        // A child, held by a pidfd as a client's process is; then it exits and is reaped,
        // so its pid is free for anyone.
        let mut child = Command::new("sleep")
            .arg("60")
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let pid = child.id() as i32;
        let pidfd = rustix::process::pidfd_open(
            rustix::process::Pid::from_raw(pid).unwrap(),
            rustix::process::PidfdFlags::empty(),
        )
        .unwrap();
        let held = Held { pid, pidfd };
        assert_eq!(held.pid(), Some(pid));
        assert!(held.is(|_| true));
        child.kill().unwrap();
        child.wait().unwrap();
        // Whatever /proc would say of that pid now, this is not the process that was asked about.
        assert_eq!(held.pid(), None);
        assert!(!held.is(|_| true));
    }
}
