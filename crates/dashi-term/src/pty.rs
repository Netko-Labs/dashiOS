//! The pseudo-terminal: the person's shell on the PTY's far end, its size,
//! and a thread that reads what it prints.

use std::ffi::{CStr, CString, OsString};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStringExt;
use std::path::Component;
use std::sync::mpsc::Sender;

use crate::Message;
use crate::integration;

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

/// The child's environment: ours, with the terminal's identity, and what the
/// shell integration sets (it wins over an inherited value of the same name).
fn environment(extra: &[(String, String)]) -> Vec<CString> {
    let mut vars: Vec<(OsString, OsString)> = std::env::vars_os()
        .filter(|(key, _)| {
            !matches!(key.to_str(), Some("TERM" | "COLORTERM" | "TERM_PROGRAM"))
                && !extra
                    .iter()
                    .any(|(name, _)| key.as_os_str() == name.as_str())
        })
        .collect();
    vars.push(("TERM".into(), "xterm-256color".into()));
    vars.push(("COLORTERM".into(), "truecolor".into()));
    vars.push(("TERM_PROGRAM".into(), "dashi-term".into()));
    vars.extend(extra.iter().map(|(key, value)| (key.into(), value.into())));
    vars.into_iter()
        .filter_map(|(key, value)| {
            let mut entry = key.into_vec();
            entry.push(b'=');
            entry.extend(value.into_vec());
            CString::new(entry).ok()
        })
        .collect()
}

/// `PWD` for a shell started in `cwd`: the folder as given, links and all, so
/// a tab opened in `~/Developer` (a link) stays there rather than in where it
/// points. Shells keep an inherited `PWD` when it is absolute, has no `.` or
/// `..`, and names their working directory; else they take `getcwd()`'s.
fn logical_pwd(cwd: &str) -> Option<String> {
    let path = std::path::Path::new(cwd);
    let plain = path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::RootDir | Component::Normal(_)));
    (plain && std::fs::metadata(path).is_ok_and(|meta| meta.is_dir())).then(|| cwd.to_string())
}

/// What the PTY's child runs, as the program's path and its argv: the
/// shell as a login shell (`-zsh`) with the integration's arguments, or a
/// command (`dashi-term -- htop`, an app whose desktop entry says
/// `Terminal=true`) through `/bin/sh`, which finds it on `PATH`: the child
/// can't search for it itself after the fork. The command's arguments are
/// passed to `exec "$@"` as they are, never parsed by the shell.
fn exec_line(shell: &CStr, args: &[String], command: &[String]) -> (CString, Vec<CString>) {
    let owned = |words: &[String]| -> Vec<CString> {
        words
            .iter()
            .filter_map(|word| CString::new(word.as_str()).ok())
            .collect()
    };
    if !command.is_empty() {
        let mut argv = vec![
            CString::from(c"sh"),
            CString::from(c"-c"),
            CString::from(c"exec \"$@\""),
            CString::from(c"sh"),
        ];
        argv.extend(owned(command));
        return (CString::from(c"/bin/sh"), argv);
    }
    let name = shell
        .to_bytes()
        .rsplit(|b| *b == b'/')
        .next()
        .unwrap_or(b"sh");
    let mut login = b"-".to_vec();
    login.extend_from_slice(name);
    let argv0 = CString::new(login).unwrap_or_else(|_| CString::from(c"-sh"));
    let mut argv = vec![argv0];
    argv.extend(owned(args));
    (shell.to_owned(), argv)
}

impl Pty {
    /// Start the shell (a login shell, `-zsh`) on a new PTY of this size,
    /// with the shell integration in `integration` (a folder) when given;
    /// or, when `command` isn't empty, that command in place of the shell
    /// (without the integration), whose exit ends the terminal.
    /// Called before any thread starts: the child only calls async-signal-safe functions.
    pub(crate) fn spawn(
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        integration: Option<&str>,
        command: &[String],
    ) -> io::Result<Pty> {
        let shell = shell();
        let name = shell
            .to_bytes()
            .rsplit(|b| *b == b'/')
            .next()
            .unwrap_or(b"sh");
        let mut launch = integration
            .filter(|_| command.is_empty())
            .map(|dir| {
                integration::launch(&String::from_utf8_lossy(name), dir, |key| {
                    std::env::var(key).ok()
                })
            })
            .unwrap_or_default();
        if let Some(pwd) = cwd.and_then(logical_pwd) {
            launch.env.push(("PWD".into(), pwd));
        }
        let (program, args) = exec_line(&shell, &launch.args, command);
        let mut argv: Vec<*const libc::c_char> = args.iter().map(|arg| arg.as_ptr()).collect();
        argv.push(std::ptr::null());
        let env = environment(&launch.env);
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
                libc::execve(program.as_ptr(), argv.as_ptr(), envp.as_ptr());
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
    use super::{environment, exec_line, logical_pwd, running_program};
    use std::ffi::CString;

    #[test]
    fn a_shell_started_through_a_link_keeps_the_links_path() {
        let root = std::env::temp_dir().join(format!("dashi-term-pwd-{}", std::process::id()));
        let real = root.join("developer");
        let link = root.join("Developer");
        std::fs::create_dir_all(&real).unwrap();
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let link = link.to_str().unwrap().to_string();
        assert_eq!(logical_pwd(&link), Some(link.clone()));
        // The shell's environment carries it, in place of the terminal's own PWD.
        let env = environment(&[("PWD".into(), link.clone())]);
        let pwds: Vec<_> = env
            .iter()
            .filter_map(|entry| entry.to_str().ok()?.strip_prefix("PWD="))
            .collect();
        assert_eq!(pwds, [link.as_str()]);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_pwd_shells_would_not_trust_is_left_out() {
        assert_eq!(logical_pwd("Developer"), None);
        assert_eq!(logical_pwd("/tmp/../tmp"), None);
        assert_eq!(logical_pwd("/tmp/./x"), None);
        assert_eq!(logical_pwd("/no/such/folder/here"), None);
        assert_eq!(logical_pwd("/"), Some("/".into()));
    }

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

    #[test]
    fn a_command_runs_in_place_of_the_shell_its_words_untouched() {
        let words = |argv: Vec<CString>| -> Vec<String> {
            argv.into_iter()
                .map(|arg| arg.into_string().unwrap())
                .collect()
        };
        let (program, argv) = exec_line(c"/bin/zsh", &["-i".into()], &[]);
        assert_eq!(program.to_str().unwrap(), "/bin/zsh");
        assert_eq!(words(argv), ["-zsh", "-i"]);
        let command = ["htop".to_string(), "--tree".into(), "a b; rm -rf ~".into()];
        let (program, argv) = exec_line(c"/bin/zsh", &["-i".into()], &command);
        assert_eq!(program.to_str().unwrap(), "/bin/sh");
        assert_eq!(
            words(argv),
            [
                "sh",
                "-c",
                "exec \"$@\"",
                "sh",
                "htop",
                "--tree",
                "a b; rm -rf ~"
            ]
        );
    }
}
