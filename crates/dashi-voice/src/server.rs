//! The socket the shell talks to: `$XDG_RUNTIME_DIR/dashi-voice.sock`, the
//! user's own (0600). One connection at a time: a new one (a restarted
//! shell) takes over. A caller from an agent's sandbox is refused: the
//! microphone and the speaker are the person's, and agents reach them only
//! through the shell (`ask_person`).

use std::{
    io::{BufRead, BufReader},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::mpsc::Sender,
    thread,
};

use crate::{
    engine::Msg,
    outbox::Outbox,
    protocol::{parse_request, reply_error},
};

pub(crate) fn socket_path() -> Result<PathBuf, String> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").ok_or("XDG_RUNTIME_DIR isn't set")?;
    Ok(PathBuf::from(runtime).join("dashi-voice.sock"))
}

pub(crate) fn listen(path: &Path) -> Result<UnixListener, String> {
    if UnixStream::connect(path).is_ok() {
        return Err(format!(
            "another dashi-voice is listening on {}",
            path.display()
        ));
    }
    let _ = std::fs::remove_file(path);
    let listener =
        UnixListener::bind(path).map_err(|error| format!("{}: {error}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(listener)
}

pub(crate) fn serve(listener: UnixListener, outbox: Outbox, engine: Sender<Msg>) {
    for stream in listener.incoming().flatten() {
        if is_agent(&stream) {
            continue;
        }
        let Ok(writer) = stream.try_clone() else {
            continue;
        };
        outbox.connect(writer);
        let outbox = outbox.clone();
        let engine = engine.clone();
        let spawned = thread::Builder::new()
            .name("client".into())
            .spawn(move || read_client(stream, &outbox, &engine));
        if let Err(error) = spawned {
            eprintln!("dashi-voice: {error}");
        }
    }
}

fn read_client(stream: UnixStream, outbox: &Outbox, engine: &Sender<Msg>) {
    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > 64 * 1024 {
            outbox.send(&reply_error(None, "line too long"));
            continue;
        }
        match parse_request(&line) {
            Ok(request) => {
                if engine.send(Msg::Request(request)).is_err() {
                    break;
                }
            }
            Err((id, error)) => outbox.send(&reply_error(id, &error)),
        }
    }
    outbox.disconnect();
    let _ = engine.send(Msg::ClientGone);
}

/// Whether the peer runs in an agent's sandbox (`dashi-agent-*.scope`, a task's `dashi-task-*`).
fn is_agent(stream: &UnixStream) -> bool {
    let Some(pid) = peer_pid(stream) else {
        return true;
    };
    std::fs::read_to_string(format!("/proc/{pid}/cgroup"))
        .map(|cgroup| cgroup.contains("dashi-agent-") || cgroup.contains("dashi-task-"))
        .unwrap_or(true)
}

fn peer_pid(stream: &UnixStream) -> Option<i32> {
    use std::os::fd::AsRawFd;
    let mut credentials = libc::ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    // SAFETY: SO_PEERCRED fills a ucred of the length given, on a socket we own.
    let result = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&raw mut credentials).cast(),
            &raw mut length,
        )
    };
    (result == 0 && credentials.pid > 0).then_some(credentials.pid)
}
