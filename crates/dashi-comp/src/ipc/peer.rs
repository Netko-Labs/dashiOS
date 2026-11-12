//! Who connected: the peer's pid (SO_PEERCRED), held by a pidfd (SO_PEERPIDFD,
//! else pidfd_open) while /proc is read, so a pid reused under us can't pass
//! as the shell (session/process.rs). Told once, when the connection is accepted.

use std::os::unix::net::UnixStream;

use crate::session::{
    process::{Held, peer_pid},
    trust,
};

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
    let pid = peer_pid(stream);
    let shell = open
        || client.is_some_and(|client| {
            // Still the same process after /proc was read? Else its pid may be someone else's now.
            Held::peer_of(stream)
                .is_some_and(|peer| peer.is(|pid| trust::is_shell_process(pid, client)))
        });
    Peer { pid, shell }
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
        // Held by its pidfd, it is this process.
        assert_eq!(Held::peer_of(&a).and_then(|peer| peer.pid()), Some(me));
    }
}
