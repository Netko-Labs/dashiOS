//! The pseudo-terminal: the person's shell on the PTY's far end, its size,
//! and a thread that reads what it prints.

use std::ffi::{CString, OsString};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStringExt;
use std::sync::mpsc::Sender;

use crate::Message;

pub(crate) struct Pty {
    master: OwnedFd,
    pub(crate) child: libc::pid_t,
}

/// The shell to run: `$SHELL`, else the account's shell, else zsh (Dashi's default).
fn shell() -> CString {
    if let Some(shell) = std::env::var_os("SHELL")
        .filter(|s| !s.is_empty())
        .and_then(|s| CString::new(s.into_vec()).ok())
    {
        return shell;
    }
    // SAFETY: getpwuid returns a pointer into static storage or null; it is read at once, before any other call.
    unsafe {
        let entry = libc::getpwuid(libc::getuid());
        if !entry.is_null() && !(*entry).pw_shell.is_null() {
            return std::ffi::CStr::from_ptr((*entry).pw_shell).to_owned();
        }
    }
    CString::from(c"/bin/zsh")
}

/// The child's environment: ours, with the terminal's identity.
fn environment() -> Vec<CString> {
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(key, _)| !matches!(key.to_str(), Some("TERM" | "COLORTERM" | "TERM_PROGRAM")))
        .collect();
    vars.push(("TERM".into(), "xterm-256color".into()));
    vars.push(("COLORTERM".into(), "truecolor".into()));
    vars.push(("TERM_PROGRAM".into(), "dashi-term".into()));
    vars.into_iter()
        .filter_map(|(key, value)| {
            let mut entry = key.into_vec();
            entry.push(b'=');
            entry.extend(value.into_vec());
            CString::new(entry).ok()
        })
        .collect()
}

impl Pty {
    /// Start the shell (a login shell, `-zsh`) on a new PTY of this size.
    /// Called before any thread starts: the child only calls async-signal-safe functions.
    pub(crate) fn spawn(cols: u16, rows: u16, cwd: Option<&str>) -> io::Result<Pty> {
        let shell = shell();
        let name = shell
            .to_bytes()
            .rsplit(|b| *b == b'/')
            .next()
            .unwrap_or(b"sh");
        let mut login = b"-".to_vec();
        login.extend_from_slice(name);
        let argv0 = CString::new(login).map_err(io::Error::other)?;
        let argv = [argv0.as_ptr(), std::ptr::null()];
        let env = environment();
        let mut envp: Vec<*const libc::c_char> = env.iter().map(|e| e.as_ptr()).collect();
        envp.push(std::ptr::null());
        let cwd = cwd.and_then(|dir| CString::new(dir).ok());
        let size = libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: 0,
            ws_ypixel: 0,
        };
        let mut master: libc::c_int = -1;
        // SAFETY: forkpty is given valid pointers; the child branch below only
        // calls chdir, execve, and _exit, which are async-signal-safe.
        let pid =
            unsafe { libc::forkpty(&mut master, std::ptr::null_mut(), std::ptr::null(), &size) };
        if pid < 0 {
            return Err(io::Error::last_os_error());
        }
        if pid == 0 {
            // SAFETY: in the child after fork: only async-signal-safe calls, then exec or exit.
            unsafe {
                if let Some(dir) = &cwd {
                    libc::chdir(dir.as_ptr());
                }
                libc::execve(shell.as_ptr(), argv.as_ptr(), envp.as_ptr());
                libc::_exit(127);
            }
        }
        // SAFETY: forkpty gave the parent a fresh descriptor that nothing else owns.
        let master = unsafe { OwnedFd::from_raw_fd(master) };
        Ok(Pty { master, child: pid })
    }

    pub(crate) fn fd(&self) -> RawFd {
        self.master.as_raw_fd()
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16, cell_w: u16, cell_h: u16) {
        let size = libc::winsize {
            ws_row: rows,
            ws_col: cols,
            ws_xpixel: cols.saturating_mul(cell_w),
            ws_ypixel: rows.saturating_mul(cell_h),
        };
        // SAFETY: the descriptor is our open PTY master and `size` is a valid winsize.
        unsafe { libc::ioctl(self.master.as_raw_fd(), libc::TIOCSWINSZ, &size) };
    }

    /// What runs in the foreground instead of the shell (a command, `ssh`,
    /// `vim`): its name, empty when it has none; None at the shell's prompt.
    pub(crate) fn foreground(&self) -> Option<String> {
        // SAFETY: the descriptor is our open PTY master; Linux answers for the far end.
        let group = unsafe { libc::tcgetpgrp(self.master.as_raw_fd()) };
        running_program(group, self.child, |pid| {
            std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()
        })
    }

    /// Read the shell's output on a thread until the PTY closes.
    pub(crate) fn read_into(&self, tx: Sender<Message>) -> io::Result<()> {
        let fd = self.master.try_clone()?;
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                // SAFETY: reading into our own buffer from a descriptor we own.
                let n = unsafe { libc::read(fd.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) };
                if n > 0 {
                    if tx
                        .send(Message::Output(buf[..n as usize].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                } else if n < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                } else {
                    // EOF, or EIO once the shell has exited.
                    let _ = tx.send(Message::Closed);
                    return;
                }
            }
        });
        Ok(())
    }
}

/// Write all of `data` to the PTY (the terminal's replies, encoded keys, paste).
pub(crate) fn write_all(fd: RawFd, mut data: &[u8]) {
    while !data.is_empty() {
        // SAFETY: writing from a live slice to an open descriptor.
        let n = unsafe { libc::write(fd, data.as_ptr().cast(), data.len()) };
        if n > 0 {
            data = &data[n as usize..];
        } else if n < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
            continue;
        } else {
            return;
        }
    }
}

/// The foreground process group's program, unless it is the shell's own
/// group (the shell leads its session, so its group is its pid) or unknown.
fn running_program(
    group: libc::pid_t,
    shell: libc::pid_t,
    name_of: impl Fn(libc::pid_t) -> Option<String>,
) -> Option<String> {
    if group <= 0 || group == shell {
        return None;
    }
    Some(
        name_of(group)
            .map(|name| name.trim().to_string())
            .unwrap_or_default(),
    )
}

/// Wait for the shell and give its exit status.
pub(crate) fn exit_code(child: libc::pid_t) -> i32 {
    let mut status = 0;
    // SAFETY: waiting on our own child.
    unsafe { libc::waitpid(child, &mut status, 0) };
    if libc::WIFEXITED(status) {
        libc::WEXITSTATUS(status)
    } else {
        128 + libc::WTERMSIG(status)
    }
}

#[cfg(test)]
mod tests {
    use super::running_program;

    #[test]
    fn the_shell_at_its_prompt_is_not_running_anything() {
        let named = |_| Some("sleep\n".to_string());
        assert_eq!(running_program(100, 100, named), None);
        assert_eq!(running_program(-1, 100, named), None);
        assert_eq!(running_program(0, 100, named), None);
    }

    #[test]
    fn another_group_in_front_is_a_running_program() {
        assert_eq!(
            running_program(120, 100, |pid| (pid == 120).then(|| "sleep\n".to_string())),
            Some("sleep".to_string())
        );
        assert_eq!(running_program(120, 100, |_| None), Some(String::new()));
    }
}
