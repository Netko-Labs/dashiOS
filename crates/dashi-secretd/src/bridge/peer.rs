//! Who is calling over the bus: the bus's own word for the caller's process
//! (GetConnectionCredentials: its ProcessFD when the bus has one, else its
//! pid), then that process's cgroup. An agent's is refused; so is a caller
//! whose process can't be found (fail closed).

use std::os::fd::AsRawFd;

use zbus::{Connection, fdo, message::Header, names::BusName};

use crate::caller::{is_agent_cgroup, parse_cgroup};

pub struct Peer {
    pub pid: u32,
    pub sender: String,
}

fn pid_of_pidfd(fd: i32) -> Option<u32> {
    let info = std::fs::read_to_string(format!("/proc/self/fdinfo/{fd}")).ok()?;
    info.lines()
        .find_map(|line| line.strip_prefix("Pid:"))
        .and_then(|pid| pid.trim().parse::<i64>().ok())
        .filter(|pid| *pid > 0)
        .map(|pid| pid as u32)
}

fn denied(why: &str) -> fdo::Error {
    fdo::Error::AccessDenied(why.into())
}

/// The calling process, if it may use the Secret Service at all.
pub async fn check(connection: &Connection, header: &Header<'_>) -> fdo::Result<Peer> {
    let sender = header.sender().ok_or_else(|| denied("no sender"))?;
    let dbus = fdo::DBusProxy::new(connection).await?;
    let credentials = dbus
        .get_connection_credentials(BusName::Unique(sender.to_owned()))
        .await?;
    // SAFETY-free: the pidfd stays open while we read the cgroup, so the pid can't be reused meanwhile.
    let pidfd = credentials.process_fd();
    let pid = pidfd
        .and_then(|fd| pid_of_pidfd(fd.as_raw_fd()))
        .or(credentials.process_id())
        .ok_or_else(|| denied("the caller's process is unknown"))?;
    let cgroup = std::fs::read_to_string(format!("/proc/{pid}/cgroup"))
        .ok()
        .as_deref()
        .and_then(parse_cgroup)
        .ok_or_else(|| denied("the caller's cgroup can't be read"))?;
    if is_agent_cgroup(&cgroup) {
        eprintln!(
            "dashi-secret-bridge: refused process {pid}: it runs in an agent's cgroup ({cgroup})"
        );
        return Err(denied(
            "agents may not use the Secret Service; ask the person through Dashi",
        ));
    }
    if let Some(fd) = pidfd
        && pid_of_pidfd(fd.as_raw_fd()) != Some(pid)
    {
        return Err(denied("the caller went away"));
    }
    Ok(Peer {
        pid,
        sender: sender.to_string(),
    })
}
