//! Who is the shell: the session's client (`-c`) and the processes under it.
//! Some requests (capture) are only theirs, as in 0.1.0.

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

/// Whether a Wayland client runs under the session client (`shell`: its pid, 0 before it starts).
pub(crate) fn is_shell_client(
    client: &smithay::reexports::wayland_server::Client,
    shell: &std::sync::atomic::AtomicI32,
) -> bool {
    let shell = shell.load(std::sync::atomic::Ordering::Relaxed);
    let Some(data) = client.get_data::<crate::state::ClientState>() else {
        return false;
    };
    // A sandboxed app runs under the shell too, but is never trusted as it.
    data.sandbox.is_none() && shell > 0 && data.pid.is_some_and(|pid| descends_from(pid, shell))
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
    fn this_process_descends_from_itself_and_its_parent() {
        let me = std::process::id() as i32;
        assert!(descends_from(me, me));
        let parent = parent_of(me).unwrap();
        assert!(parent <= 1 || descends_from(me, parent));
        assert!(!descends_from(me, i32::MAX));
    }
}
