//! dashi-secretd-pam: the login's half of the vault, run by pam_exec (as
//! root, like gnome-keyring's PAM module):
//!
//!   auth     optional pam_exec.so expose_authtok quiet /usr/libexec/dashi/dashi-secretd-pam
//!   session  optional pam_exec.so quiet /usr/libexec/dashi/dashi-secretd-pam
//!
//! At `auth` it reads the password pam_exec gives on stdin and hands it to
//! dashi-secretd, which opens the person's vault (or makes it, the first time,
//! and imports their gnome-keyring login keyring). At `close_session` it locks
//! the vault. It never fails a login: the vault is a convenience, not a gate.
//! The password is never printed or written anywhere.

use std::{
    ffi::{CStr, CString},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use dashi_secretd::{SOCKET, client::Client};
use zeroize::Zeroizing;

const MAX_PASSWORD: usize = 4096;
const MAX_KEYRING: u64 = 4 * 1024 * 1024;

/// A user's uid and home, from the password database.
fn user(name: &str) -> Option<(u32, PathBuf)> {
    let name = CString::new(name).ok()?;
    // SAFETY: getpwnam takes a NUL-terminated string; its result is read at
    // once, before any other call that could overwrite the static buffer.
    unsafe {
        let entry = libc::getpwnam(name.as_ptr());
        if entry.is_null() {
            return None;
        }
        let home = CStr::from_ptr((*entry).pw_dir)
            .to_string_lossy()
            .into_owned();
        Some(((*entry).pw_uid, PathBuf::from(home)))
    }
}

/// The login keyring, if the person has one: a regular file of theirs, not
/// a link (root reads it, so it must not be pointed elsewhere). Opened
/// without blocking, so a FIFO there can't hold up the login.
fn keyring(home: &Path, uid: u32) -> Option<Vec<u8>> {
    let path = home.join(".local/share/keyrings/login.keyring");
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_NOCTTY)
        .open(path)
        .ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.uid() != uid || meta.len() > MAX_KEYRING {
        return None;
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn run() -> Result<(), String> {
    let name = std::env::var("PAM_USER").map_err(|_| "no PAM_USER")?;
    let (uid, home) = user(&name).ok_or("no such user")?;
    if uid == 0 {
        return Ok(());
    }
    let kind = std::env::var("PAM_TYPE").unwrap_or_default();
    let lock = std::env::args().nth(1).as_deref() == Some("lock") || kind == "close_session";
    let mut client = Client::connect(Path::new(SOCKET))?;
    if lock {
        client.call(&serde_json::json!({ "op": "lock", "user": uid }))?;
        return Ok(());
    }
    if kind != "auth" && !kind.is_empty() {
        return Ok(());
    }
    let mut password = Zeroizing::new(Vec::new());
    std::io::stdin()
        .take(MAX_PASSWORD as u64 + 1)
        .read_to_end(&mut password)
        .map_err(|e| e.to_string())?;
    // pam_exec ends the token with a NUL.
    while matches!(password.last(), Some(0 | b'\n')) {
        password.pop();
    }
    if password.is_empty() || password.len() > MAX_PASSWORD {
        return Err("no password".into());
    }
    let encoded = Zeroizing::new(STANDARD.encode(password.as_slice()));
    let keyring = keyring(&home, uid).map(|bytes| STANDARD.encode(bytes));
    let mut request = Zeroizing::new(format!(
        "{{\"op\":\"unlock\",\"user\":{uid},\"password\":\"{}\"",
        encoded.as_str()
    ));
    if let Some(keyring) = keyring {
        request.push_str(",\"keyring\":\"");
        request.push_str(&keyring);
        request.push('"');
    }
    request.push('}');
    client.call_line(&request)?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        // Never the password; just why the vault stayed shut.
        eprintln!("dashi-secretd-pam: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::mpsc, time::Duration};

    fn uid() -> u32 {
        // SAFETY: getuid has no preconditions and can't fail.
        unsafe { libc::getuid() }
    }

    #[test]
    fn a_regular_keyring_is_read_and_a_fifo_is_passed_over() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".local/share/keyrings");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("login.keyring");
        std::fs::write(&path, b"keyring").unwrap();
        assert_eq!(
            keyring(home.path(), uid()).as_deref(),
            Some(&b"keyring"[..])
        );
        assert_eq!(keyring(home.path(), uid() + 1), None);

        std::fs::remove_file(&path).unwrap();
        let name = CString::new(path.as_os_str().as_bytes()).unwrap();
        // SAFETY: a NUL-terminated path in a directory of our own.
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        let (done, wait) = mpsc::channel();
        let at = home.path().to_owned();
        std::thread::spawn(move || {
            let _ = done.send(keyring(&at, uid()));
        });
        // Blocking here (no writer ever comes) would fail rather than hang.
        assert_eq!(wait.recv_timeout(Duration::from_secs(5)), Ok(None));
    }
}
