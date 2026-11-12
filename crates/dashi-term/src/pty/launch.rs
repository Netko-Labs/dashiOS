//! What the shell is started with: which shell, its environment, its working
//! folder, and the program and arguments the child execs.

use std::ffi::{CStr, CString, OsString};
use std::os::unix::ffi::OsStringExt;

/// The shell to run: `$SHELL`, else the account's shell, else zsh (Dashi's default).
pub(super) fn shell() -> CString {
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
pub(super) fn environment(extra: &[(String, String)]) -> Vec<CString> {
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
pub(super) fn logical_pwd(cwd: &str) -> Option<String> {
    // Checked on the text itself: `Path::components` drops a `.` in the middle
    // ("/tmp/./x" reads as "/tmp/x"), so it would let one through.
    let plain = cwd == "/"
        || cwd.strip_prefix('/').is_some_and(|rest| {
            rest.split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..")
        });
    (plain && std::fs::metadata(cwd).is_ok_and(|meta| meta.is_dir())).then(|| cwd.to_string())
}

/// What the PTY's child runs, as the program's path and its argv: the
/// shell as a login shell (`-zsh`) with the integration's arguments, or a
/// command (`dashi-term -- htop`, an app whose desktop entry says
/// `Terminal=true`) through `/bin/sh`, which finds it on `PATH`: the child
/// can't search for it itself after the fork. The command's arguments are
/// passed to `exec "$@"` as they are, never parsed by the shell.
pub(super) fn exec_line(
    shell: &CStr,
    args: &[String],
    command: &[String],
) -> (CString, Vec<CString>) {
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
