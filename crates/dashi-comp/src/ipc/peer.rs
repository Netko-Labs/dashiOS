//! Who connected: the peer's pid (SO_PEERCRED), held by a pidfd (SO_PEERPIDFD,
//! else pidfd_open) while /proc is read, so a pid reused under us can't pass
//! as the shell. Told once, when the connection is accepted.

use std::{
    os::{
        fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
        unix::net::UnixStream,
    },
    path::Path,
};

use crate::session::trust;

/// SO_PEERPIDFD, Linux 6.5 (not in every libc crate yet).
const SO_PEERPIDFD: libc::c_int = 77;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Peer {
    /// Its process, when the kernel says.
    pub pid: Option<i32>,
    /// One of the shell's own processes (session/trust.rs).
    pub shell: bool,
}

/// Who is on the other end of `stream`. `client` is the session client's pid;
/// with `open`, every connection is the shell's (no session to tell it by).
pub(crate) fn identify(stream: &UnixStream, client: Option<i32>, open: bool) -> Peer {
    let pid = rustix::net::sockopt::socket_peercred(stream)
        .ok()
        .map(|cred| cred.pid.as_raw_nonzero().get());
    let shell = open
        || match (pid, client) {
            (Some(pid), Some(client)) => is_shell(stream.as_raw_fd(), pid, client),
            _ => false,
        };
    Peer { pid, shell }
}

fn is_shell(fd: RawFd, pid: i32, client: i32) -> bool {
    let Some(pidfd) = peer_pidfd(fd, pid) else {
        return false;
    };
    // Still the same process after /proc was read? Else its pid may be someone else's now.
    trust::is_shell_process(pid, client) && pidfd_pid(&pidfd) == Some(pid)
}

fn peer_pidfd(fd: RawFd, pid: i32) -> Option<OwnedFd> {
    let mut pidfd: libc::c_int = -1;
    let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `pidfd` and `len` are valid for writes of an int, and `fd` is a
    // socket the caller holds open.
    let rc = unsafe {
        libc::getsockopt(
            fd,
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
    use super::*;

    #[test]
    fn a_peer_is_known_by_its_pid_and_its_group() {
        let (a, _b) = UnixStream::pair().unwrap();
        let me = std::process::id() as i32;
        let open = identify(&a, None, true);
        assert_eq!(
            open,
            Peer {
                pid: Some(me),
                shell: true
            }
        );
        // No session client: no one is the shell.
        assert!(!identify(&a, None, false).shell);
        // A session client this process doesn't run under.
        assert!(!identify(&a, Some(i32::MAX - 1), false).shell);
        // The pidfd says this process.
        let pidfd = peer_pidfd(a.as_raw_fd(), me).unwrap();
        assert_eq!(pidfd_pid(&pidfd), Some(me));
    }
}
