//! The socket, `$XDG_RUNTIME_DIR/dashi-voice.sock` (mode 0600). One thread
//! per connection; the caller is checked once, when it connects (caller.rs).
//! A request that waits on a model (`listen.stop`, `warm`) is answered from
//! a thread of its own, so the connection can still say `speak.stop`.

use std::io::{BufRead, BufReader};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::caller;
use crate::hub::{Sink, send};
use crate::protocol::{self, MAX_LINE, Request};
use crate::service::Service;

const MAX_CONNECTIONS: usize = 32;
/// How often unused models are looked for.
const HOUSEKEEPING: Duration = Duration::from_secs(30);

/// The listening socket systemd passed us (LISTEN_FDS), if it did.
fn activated() -> Option<UnixListener> {
    let pid: u32 = std::env::var("LISTEN_PID").ok()?.parse().ok()?;
    let fds: u32 = std::env::var("LISTEN_FDS").ok()?.parse().ok()?;
    (pid == std::process::id() && fds >= 1).then(|| {
        // SAFETY: systemd hands the first socket over as fd 3 and nothing else owns it.
        unsafe { UnixListener::from_raw_fd(3) }
    })
}

/// The socket to serve: systemd's, else one bound at `path`. A socket that still answers is never taken over.
pub(crate) fn listener(path: &Path) -> Result<UnixListener, String> {
    if let Some(listener) = activated() {
        return Ok(listener);
    }
    if UnixStream::connect(path).is_ok() {
        return Err(format!("{} is already served", path.display()));
    }
    let _ = std::fs::remove_file(path);
    let listener =
        UnixListener::bind(path).map_err(|error| format!("{}: {error}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(listener)
}

/// One line without its newline, `MAX_LINE` at most; none at the end.
pub(crate) fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let (chunk, done) = match available.iter().position(|byte| *byte == b'\n') {
            Some(at) => (&available[..at], Some(at + 1)),
            None => (available, None),
        };
        if line.len() + chunk.len() > MAX_LINE {
            return Err(std::io::Error::other("line too long"));
        }
        line.extend_from_slice(chunk);
        let used = done.unwrap_or(available.len());
        reader.consume(used);
        if done.is_some() {
            return Ok(Some(line));
        }
    }
}

/// Serve one connection's requests until it closes.
pub(crate) fn converse(
    service: &Arc<Service>,
    connection: u64,
    reader: &mut impl BufRead,
    sink: &Sink,
) {
    while let Ok(Some(line)) = read_line(reader) {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let (id, request) = protocol::parse(&line);
        let slow = matches!(request, Ok(Request::ListenStop | Request::Warm(_)));
        let answer = {
            let (service, sink) = (service.clone(), sink.clone());
            move || {
                let result = request.and_then(|request| service.handle(connection, &sink, request));
                send(&sink, &protocol::reply(id, result))
            }
        };
        if slow {
            std::thread::spawn(answer);
        } else if !answer() {
            break;
        }
    }
    service.hang_up(connection);
}

fn serve_connection(service: &Arc<Service>, connection: u64, stream: UnixStream) {
    // A reader that stops reading is dropped, not waited for.
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let admitted = caller::admit(stream.as_raw_fd());
    let sink: Sink = Arc::new(Mutex::new(stream));
    if let Err(why) = admitted {
        send(&sink, &protocol::reply(None, Err(why)));
        return;
    }
    converse(service, connection, &mut BufReader::new(read_half), &sink);
}

pub(crate) fn serve(listener: UnixListener, service: Arc<Service>) {
    let housekeeper = service.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(HOUSEKEEPING);
            housekeeper.rest();
        }
    });
    let active = Arc::new(AtomicUsize::new(0));
    let next = AtomicU64::new(1);
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            let sink: Sink = Arc::new(Mutex::new(stream));
            send(
                &sink,
                &protocol::reply(None, Err("too many connections".into())),
            );
            continue;
        }
        active.fetch_add(1, Ordering::SeqCst);
        let connection = next.fetch_add(1, Ordering::SeqCst);
        let (service, active) = (service.clone(), active.clone());
        std::thread::spawn(move || {
            serve_connection(&service, connection, stream);
            active.fetch_sub(1, Ordering::SeqCst);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_bounded_and_split_at_newlines() {
        let mut input = std::io::Cursor::new(b"one\ntwo".to_vec());
        assert_eq!(read_line(&mut input).unwrap().unwrap(), b"one");
        assert_eq!(read_line(&mut input).unwrap().unwrap(), b"two");
        assert!(read_line(&mut input).unwrap().is_none());
        let mut huge = std::io::Cursor::new(vec![b'x'; MAX_LINE + 1]);
        assert!(read_line(&mut huge).is_err());
    }

    #[test]
    fn a_socket_is_bound_for_its_owner_only_and_never_taken_over() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("voice.sock");
        // A file left by a service that died is replaced.
        std::fs::write(&path, "").unwrap();
        let first = listener(&path).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert!(listener(&path).unwrap_err().contains("already served"));
        drop(first);
    }
}
