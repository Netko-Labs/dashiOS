//! Who is the shell: the session's client (`-c`), its process group, and the
//! sessions it started. One rule for the IPC (ipc/peer.rs) and the
//! privileged Wayland protocols (screencopy, data-control,
//! foreign-toplevel, session-lock, the input method).

/// The parent of `pid`, from /proc/<pid>/stat (the field after the command,
/// which may itself hold spaces and parentheses).
fn parent_of(pid: i32) -> Option<i32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_parent(&stat)
}

fn parse_parent(stat: &str) -> Option<i32> {
    let after = &stat[stat.rfind(')')? + 1..];
    after.split_whitespace().nth(1)?.parse().ok()
}

/// What /proc/<pid>/stat says about where a process sits.
#[derive(Debug, PartialEq, Eq)]
struct Stat {
    parent: i32,
    group: i32,
    session: i32,
}

fn stat_of(pid: i32) -> Option<Stat> {
    parse_stat(&std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}

/// `pid (comm) state ppid pgrp session ...`.
fn parse_stat(stat: &str) -> Option<Stat> {
    let mut after = stat[stat.rfind(')')? + 1..].split_whitespace().skip(1);
    let mut next = || after.next()?.parse().ok();
    Some(Stat {
        parent: next()?,
        group: next()?,
        session: next()?,
    })
}

/// Whether `pid` is one of the shell's own processes, for the session client
/// `client` (which leads its own process group): in that group and under it,
/// or in a session whose leader that group started.
pub(crate) fn is_shell_process(pid: i32, client: i32) -> bool {
    let Some(stat) = stat_of(pid) else {
        return false;
    };
    if stat.group == client {
        return descends_from(pid, client);
    }
    let leader = if stat.session == pid {
        Some(stat)
    } else {
        stat_of(stat.session)
    };
    leader
        .filter(|leader| leader.parent > 1)
        .and_then(|leader| stat_of(leader.parent))
        .is_some_and(|parent| parent.group == client)
}

/// Whether `pid` is `ancestor` or runs under it.
pub(crate) fn descends_from(pid: i32, ancestor: i32) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if current == ancestor {
            return true;
        }
        match parent_of(current) {
            Some(parent) if parent > 1 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}

/// Whether a Wayland client is one of the shell's own processes, by the same
/// rule as the IPC's (`is_shell_process`): the session client (`shell`: its
/// pid, 0 before it starts) and its group, and the sessions it started (the
/// shell, and what the shell runs in its own session: its Metal hosts, the
/// clipboard's wl-paste, the input method). An app the shell launches has a
/// session of its own and is not the shell, though it runs under it; it gets
/// a privileged protocol only as the shell grants it (`screencopy-clients`).
pub(crate) fn is_shell_client(
    client: &smithay::reexports::wayland_server::Client,
    shell: &std::sync::atomic::AtomicI32,
) -> bool {
    let shell = shell.load(std::sync::atomic::Ordering::Relaxed);
    let Some(data) = client.get_data::<crate::state::ClientState>() else {
        return false;
    };
    // A sandboxed app runs under the shell too, but is never trusted as it.
    data.sandbox.is_none() && shell > 0 && data.pid.is_some_and(|pid| is_shell_process(pid, shell))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_parent_follows_the_command_whatever_it_holds() {
        assert_eq!(parse_parent("4242 (bun) S 4200 4242 4242 0"), Some(4200));
        assert_eq!(parse_parent("17 (a (weird) name) R 9 17 17"), Some(9));
        assert_eq!(parse_parent("garbage"), None);
    }

    #[test]
    fn stat_says_parent_group_and_session() {
        assert_eq!(
            parse_stat("4242 (a (b) c) S 4200 4100 4000 0"),
            Some(Stat {
                parent: 4200,
                group: 4100,
                session: 4000
            })
        );
        assert_eq!(parse_stat("4242 (bun) S 4200"), None);
    }

    #[test]
    fn a_process_outside_the_group_is_not_the_shell() {
        let me = std::process::id() as i32;
        // This test's own group leads, or not; a group nobody leads is never the shell's.
        assert!(!is_shell_process(me, i32::MAX));
        assert!(!is_shell_process(i32::MAX, me));
        let group = rustix::process::getpgrp().as_raw_nonzero().get();
        if group == me {
            assert!(is_shell_process(me, me));
        }
    }

    #[test]
    fn this_process_descends_from_itself_and_its_parent() {
        let me = std::process::id() as i32;
        assert!(descends_from(me, me));
        let parent = parent_of(me).unwrap();
        assert!(parent <= 1 || descends_from(me, parent));
        assert!(!descends_from(me, i32::MAX));
    }
}
