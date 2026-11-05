//! The socket, `/run/dashi-secretd/socket` (mode 0666: who may do what is
//! decided per request from the peer's credentials, not by the file's mode).
//! One thread per connection; the caller is identified once, when it
//! connects, and an agent is turned away at the door.

use std::{
    io::{BufRead, BufReader, Write},
    os::{
        fd::AsRawFd,
        unix::net::{UnixListener, UnixStream},
    },
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
};

use zeroize::Zeroizing;

use crate::{
    caller,
    daemon::{
        Daemon,
        protocol::{MAX_LINE, Request},
        reply::Reply,
    },
};

const MAX_CONNECTIONS: usize = 128;

/// Read one line (without its newline) into memory that is zeroed after; None at the end.
fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<Zeroizing<Vec<u8>>>> {
    let mut line = Zeroizing::new(Vec::new());
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let (chunk, done) = match available.iter().position(|b| *b == b'\n') {
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

fn reply(stream: &mut UnixStream, result: Result<Reply, String>) -> std::io::Result<()> {
    let mut line = Reply::line(result);
    line.push('\n');
    stream.write_all(line.as_bytes())
}

fn serve_connection(mut stream: UnixStream, daemon: &Mutex<Daemon>) {
    let caller = match caller::identify(stream.as_raw_fd()) {
        Ok(caller) => caller,
        Err(error) => {
            let _ = reply(&mut stream, Err(error));
            return;
        }
    };
    if caller.is_agent() {
        eprintln!(
            "dashi-secretd: refused process {} (uid {}): it runs in an agent's cgroup ({})",
            caller.pid, caller.uid, caller.cgroup
        );
        let _ = reply(
            &mut stream,
            Err("agents may not use the vault; ask the person through Dashi".into()),
        );
        return;
    }
    let Ok(read_half) = stream.try_clone() else {
        return;
    };
    let mut reader = BufReader::new(read_half);
    while let Ok(Some(line)) = read_line(&mut reader) {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        // The request is never echoed or logged: it may hold a password.
        let result = match serde_json::from_slice::<Request>(&line) {
            Err(_) => Err("not a request dashi-secretd knows".into()),
            Ok(request) => match daemon.lock() {
                Ok(mut daemon) => daemon.handle(&caller, request),
                Err(_) => Err("dashi-secretd is not well".into()),
            },
        };
        if reply(&mut stream, result).is_err() {
            return;
        }
    }
}

pub fn serve(listener: UnixListener, daemon: Arc<Mutex<Daemon>>) {
    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else { continue };
        if active.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
            let _ = reply(&mut stream, Err("too many connections".into()));
            continue;
        }
        active.fetch_add(1, Ordering::SeqCst);
        let (daemon, active) = (daemon.clone(), active.clone());
        thread::spawn(move || {
            serve_connection(stream, &daemon);
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
        assert_eq!(read_line(&mut input).unwrap().unwrap().as_slice(), b"one");
        assert_eq!(read_line(&mut input).unwrap().unwrap().as_slice(), b"two");
        assert!(read_line(&mut input).unwrap().is_none());
        let mut huge = std::io::Cursor::new(vec![b'x'; MAX_LINE + 1]);
        assert!(read_line(&mut huge).is_err());
    }
}
