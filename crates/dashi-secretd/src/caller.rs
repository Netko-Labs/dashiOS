//! Who is on the other end of a socket: its uid and pid from the kernel
//! (SO_PEERCRED), held by a pidfd (SO_PEERPIDFD, else pidfd_open) so the pid
//! can't be reused under us while its cgroup is read, then its cgroup. An
//! agent runs in a `dashi-agent-*.scope` (session/dashi-agent); anything in
//! one is refused everything, and so is a caller whose cgroup can't be read.

use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};

/// SO_PEERPIDFD, Linux 6.5 (not in every libc crate yet).
const SO_PEERPIDFD: libc::c_int = 77;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    pub uid: u32,
    pub pid: i32,
    /// The unified (v2) cgroup path, "/user.slice/…/app.slice/x.scope".
    pub cgroup: String,
}

impl Caller {
    pub fn is_agent(&self) -> bool {
        is_agent_cgroup(&self.cgroup)
    }
}

/// Whether a cgroup path is, or is under, an agent's unit. Any path element
/// named `dashi-agent-…` counts, whatever its unit type: fail closed.
pub fn is_agent_cgroup(path: &str) -> bool {
    path.split('/').any(|part| part.starts_with("dashi-agent-"))
}

/// The unified hierarchy's line of /proc/<pid>/cgroup ("0::/path").
pub fn parse_cgroup(contents: &str) -> Option<String> {
    contents
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .map(str::to_owned)
        .filter(|path| path.starts_with('/'))
}

/// The pid a pidfd refers to, from /proc/self/fdinfo (-1 once it exited).
fn pidfd_pid(pidfd: RawFd) -> Option<i32> {
    let info = std::fs::read_to_string(format!("/proc/self/fdinfo/{pidfd}")).ok()?;
    info.lines()
        .find_map(|line| line.strip_prefix("Pid:"))
        .and_then(|pid| pid.trim().parse().ok())
}

fn peer_credentials(fd: RawFd) -> Result<libc::ucred, String> {
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
    if rc != 0 || cred.pid <= 0 {
        return Err("who is calling is unknown".into());
    }
    Ok(cred)
}

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
    // Older kernels: open one by pid; checked against the pid below all the same.
    // SAFETY: pidfd_open takes a pid and flags and returns a new fd or -1.
    let raw = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
    (raw >= 0).then(|| {
        // SAFETY: a new fd from the kernel, owned by nobody else.
        unsafe { OwnedFd::from_raw_fd(raw as RawFd) }
    })
}

/// Identify the process on the other end of the connected Unix socket `fd`.
pub fn identify(fd: RawFd) -> Result<Caller, String> {
    let cred = peer_credentials(fd)?;
    let pidfd = peer_pidfd(fd, cred.pid).ok_or("who is calling is unknown")?;
    let cgroup = std::fs::read_to_string(format!("/proc/{}/cgroup", cred.pid))
        .ok()
        .as_deref()
        .and_then(parse_cgroup)
        .ok_or("the caller's cgroup can't be read")?;
    // Still the same process? If it exited and the pid was reused, the
    // cgroup read above may be someone else's: refuse.
    if pidfd_pid(pidfd.as_raw_fd()) != Some(cred.pid) {
        return Err("the caller went away".into());
    }
    Ok(Caller {
        uid: cred.uid,
        pid: cred.pid,
        cgroup,
    })
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
        // Anything under an agent's unit is the agent's too.
        assert!(is_agent_cgroup(
            "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-x.scope/sub"
        ));
        assert!(is_agent_cgroup("/user.slice/dashi-agent-codex.service"));
        assert!(!is_agent_cgroup(
            "/user.slice/user-1000.slice/session-2.scope"
        ));
        assert!(!is_agent_cgroup(
            "/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-secret-bridge.service"
        ));
    }

    #[test]
    fn only_the_unified_hierarchy_counts() {
        assert_eq!(
            parse_cgroup("12:pids:/x\n0::/user.slice/a.scope\n").as_deref(),
            Some("/user.slice/a.scope")
        );
        assert_eq!(parse_cgroup("1:name=systemd:/x\n"), None);
        assert_eq!(parse_cgroup("0::relative\n"), None);
    }

    #[test]
    fn a_peer_is_identified_by_the_kernel() {
        let (a, _b) = UnixStream::pair().unwrap();
        let caller = identify(a.as_raw_fd()).unwrap();
        assert_eq!(caller.pid as u32, std::process::id());
        // SAFETY: getuid has no preconditions.
        assert_eq!(caller.uid, unsafe { libc::getuid() });
        assert!(caller.cgroup.starts_with('/'));
    }
}
