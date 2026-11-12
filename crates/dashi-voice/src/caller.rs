//! Who is on the other end of the socket, from the kernel (SO_PEERCRED): its
//! uid and, by its pid, its cgroup. Only the person's own processes may ask,
//! and never an agent's: an agent runs in a `dashi-agent-*` scope
//! (session/dashi-agent) and reaches the person's voice through the shell's
//! tools, which ask the person first. The same rule as the vault's
//! (crates/dashi-secretd/src/caller.rs).

use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};

/// SO_PEERPIDFD, Linux 6.5 (not in every libc crate yet).
const SO_PEERPIDFD: libc::c_int = 77;

/// Whether a cgroup path is, or is under, an agent's unit: fail closed on any `dashi-agent-…` element.
pub(crate) fn is_agent_cgroup(path: &str) -> bool {
    path.split('/').any(|part| part.starts_with("dashi-agent-"))
}

/// The unified hierarchy's line of /proc/<pid>/cgroup ("0::/path").
pub(crate) fn parse_cgroup(contents: &str) -> Option<String> {
    contents
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .map(str::to_owned)
        .filter(|path| path.starts_with('/'))
}

fn peer(fd: RawFd) -> Option<libc::ucred> {
    let mut cred = libc::ucred {
        pid: 0,
        uid: u32::MAX,
        gid: u32::MAX,
    };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: `cred` and `len` are valid for writes of the sizes given; the
    // kernel writes at most `len` bytes and updates `len`.
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut libc::ucred).cast(),
            &mut len,
        )
    };
    (rc == 0 && cred.pid > 0).then_some(cred)
}

/// A handle on the caller's process, so its pid can't be given to another
/// while its cgroup is read: the kernel's (SO_PEERPIDFD), else one opened by pid.
fn peer_pidfd(fd: RawFd, pid: i32) -> Option<OwnedFd> {
    let mut pidfd: libc::c_int = -1;
    let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: `pidfd` and `len` are valid for writes of an int.
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
    // SAFETY: pidfd_open takes a pid and flags and returns a new fd or -1.
    let raw = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    (raw >= 0).then(|| {
        // SAFETY: a new fd from the kernel, owned by nobody else.
        unsafe { OwnedFd::from_raw_fd(raw as RawFd) }
    })
}

/// The pid a pidfd refers to, from /proc/self/fdinfo (-1 once it exited).
fn pidfd_pid(pidfd: RawFd) -> Option<i32> {
    let info = std::fs::read_to_string(format!("/proc/self/fdinfo/{pidfd}")).ok()?;
    info.lines()
        .find_map(|line| line.strip_prefix("Pid:"))
        .and_then(|pid| pid.trim().parse().ok())
}

/// Whether the process on the other end of the connected socket `fd` may use Voice; else why not.
pub(crate) fn admit(fd: RawFd) -> Result<(), String> {
    let cred = peer(fd).ok_or("who is calling is unknown")?;
    // SAFETY: getuid has no preconditions.
    let me = unsafe { libc::getuid() };
    if cred.uid != me {
        return Err("Voice is only for the person whose session this is".into());
    }
    let pidfd = peer_pidfd(fd, cred.pid).ok_or("who is calling is unknown")?;
    let cgroup = std::fs::read_to_string(format!("/proc/{}/cgroup", cred.pid))
        .ok()
        .as_deref()
        .and_then(parse_cgroup)
        .ok_or("the caller's cgroup can't be read")?;
    // Still the same process? If it exited and its pid was given to another,
    // the cgroup read above may be someone else's: refuse.
    if pidfd_pid(pidfd.as_raw_fd()) != Some(cred.pid) {
        return Err("the caller went away".into());
    }
    if is_agent_cgroup(&cgroup) {
        eprintln!(
            "dashi-voice: refused process {}: it runs in an agent's cgroup ({cgroup})",
            cred.pid
        );
        return Err("agents may not use Voice themselves; ask the person through Dashi".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixStream;

    use super::*;

    #[test]
    fn agents_are_known_by_their_unit() {
        assert!(is_agent_cgroup(
            "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-claude-1a2b.scope"
        ));
        assert!(is_agent_cgroup("/user.slice/dashi-agent-x.scope/sub"));
        assert!(!is_agent_cgroup(
            "/user.slice/user-1000.slice/session-2.scope"
        ));
        assert!(!is_agent_cgroup(
            "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-voice.service"
        ));
        assert_eq!(
            parse_cgroup("12:pids:/x\n0::/user.slice/a.scope\n").as_deref(),
            Some("/user.slice/a.scope")
        );
        assert_eq!(parse_cgroup("0::relative\n"), None);
    }

    #[test]
    fn the_persons_own_process_is_let_in() {
        let (a, _b) = UnixStream::pair().unwrap();
        // This test is the person's own process, in no agent's unit... unless an agent runs the tests.
        let cgroup = parse_cgroup(&std::fs::read_to_string("/proc/self/cgroup").unwrap()).unwrap();
        assert_eq!(admit(a.as_raw_fd()).is_ok(), !is_agent_cgroup(&cgroup));
    }
}
