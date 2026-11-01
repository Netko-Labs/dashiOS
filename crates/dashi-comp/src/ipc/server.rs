//! The IPC socket (`$XDG_RUNTIME_DIR/dashi-comp.sock`, or `DASHI_COMP_SOCKET`):
//! accepting connections, reading their requests on the event loop, and
//! writing replies and events without ever blocking it.

use std::{
    collections::HashMap,
    io::{self, ErrorKind, Read, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
};

use smithay::reexports::calloop::{Interest, LoopHandle, Mode, PostAction, generic::Generic};

use super::{
    frame::{self, LineBuffer},
    requests,
};
use crate::state::Dashi;

/// A client that falls this far behind on reading is dropped instead of buffered forever.
const MAX_BACKLOG: usize = 8 << 20;

pub(crate) type ConnectionId = u64;

struct Connection {
    writer: UnixStream,
    subscribed: bool,
    backlog: Vec<u8>,
}

/// The listening socket and the connected clients' write sides.
pub(crate) struct Ipc {
    path: PathBuf,
    connections: HashMap<ConnectionId, Connection>,
    next_id: ConnectionId,
}

impl Ipc {
    /// Bind the socket (mode 0600). A socket left by a compositor that is gone is
    /// replaced; one that still answers is not taken over.
    pub(crate) fn bind(path: &Path) -> io::Result<(Self, UnixListener)> {
        if path.exists() {
            if UnixStream::connect(path).is_ok() {
                return Err(io::Error::new(
                    ErrorKind::AddrInUse,
                    format!(
                        "another dashi-comp answers on {}; set DASHI_COMP_SOCKET to run beside it",
                        path.display()
                    ),
                ));
            }
            std::fs::remove_file(path)?;
        }
        let listener = UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        listener.set_nonblocking(true)?;
        Ok((
            Self {
                path: path.to_owned(),
                connections: HashMap::new(),
                next_id: 1,
            },
            listener,
        ))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Start accepting on the event loop.
    pub(crate) fn listen(
        listener: UnixListener,
        handle: &LoopHandle<'static, Dashi>,
    ) -> io::Result<()> {
        handle
            .insert_source(
                Generic::new(listener, Interest::READ, Mode::Level),
                |_, listener, state| {
                    loop {
                        match listener.accept() {
                            Ok((stream, _)) => state.ipc_accept(stream),
                            Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                            Err(error) => {
                                tracing::warn!(%error, "IPC accept");
                                break;
                            }
                        }
                    }
                    Ok(PostAction::Continue)
                },
            )
            .map_err(|error| io::Error::other(error.to_string()))?;
        Ok(())
    }

    fn add(&mut self, writer: UnixStream) -> ConnectionId {
        let id = self.next_id;
        self.next_id += 1;
        self.connections.insert(
            id,
            Connection {
                writer,
                subscribed: false,
                backlog: Vec::new(),
            },
        );
        id
    }

    pub(crate) fn remove(&mut self, id: ConnectionId) {
        self.connections.remove(&id);
    }

    /// Someone hears events (the shell is there to decide).
    pub(crate) fn has_subscribers(&self) -> bool {
        self.connections.values().any(|c| c.subscribed)
    }

    /// From now on, `id` hears events.
    pub(crate) fn subscribe(&mut self, id: ConnectionId) {
        if let Some(connection) = self.connections.get_mut(&id) {
            connection.subscribed = true;
        }
    }

    /// Queue `line` for `id` and send what the socket takes.
    pub(crate) fn send(&mut self, id: ConnectionId, line: &str) {
        let Some(connection) = self.connections.get_mut(&id) else {
            return;
        };
        connection.backlog.extend_from_slice(line.as_bytes());
        if !write_some(connection) {
            self.remove(id);
        }
    }

    /// Tell every subscribed connection.
    pub(crate) fn emit(&mut self, name: &str, fields: serde_json::Value) {
        let line = frame::event(name, fields);
        let subscribed: Vec<ConnectionId> = self
            .connections
            .iter()
            .filter(|(_, c)| c.subscribed)
            .map(|(id, _)| *id)
            .collect();
        for id in subscribed {
            self.send(id, &line);
        }
    }

    /// Send what is still queued (after each turn of the event loop).
    pub(crate) fn flush(&mut self) {
        let stuck: Vec<ConnectionId> = self
            .connections
            .iter_mut()
            .filter(|(_, c)| !c.backlog.is_empty())
            .filter_map(|(id, c)| (!write_some(c)).then_some(*id))
            .collect();
        for id in stuck {
            self.remove(id);
        }
    }
}

impl Drop for Ipc {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Write as much of the backlog as the socket takes now. False: drop this connection.
fn write_some(connection: &mut Connection) -> bool {
    while !connection.backlog.is_empty() {
        match connection.writer.write(&connection.backlog) {
            Ok(0) => return false,
            Ok(written) => {
                connection.backlog.drain(..written);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => break,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => return false,
        }
    }
    connection.backlog.len() <= MAX_BACKLOG
}

impl Dashi {
    fn ipc_accept(&mut self, stream: UnixStream) {
        let writer = match stream
            .set_nonblocking(true)
            .and_then(|()| stream.try_clone())
        {
            Ok(writer) => writer,
            Err(error) => return tracing::warn!(%error, "IPC connection"),
        };
        let id = self.ipc.add(writer);
        let mut lines = LineBuffer::default();
        let inserted = self.loop_handle.insert_source(
            Generic::new(stream, Interest::READ, Mode::Level),
            move |_, stream, state| {
                let mut chunk = [0u8; 16 * 1024];
                loop {
                    // SAFETY: reading does not move or close the stream the source owns.
                    let read = unsafe { stream.get_mut() }.read(&mut chunk);
                    match read {
                        Ok(0) => break,
                        Ok(n) => match lines.push(&chunk[..n]) {
                            Ok(complete) => {
                                for line in complete.iter().filter(|l| !l.trim().is_empty()) {
                                    state.ipc_line(id, line);
                                }
                            }
                            Err(frame::TooLong) => break,
                        },
                        Err(error) if error.kind() == ErrorKind::WouldBlock => {
                            return Ok(PostAction::Continue);
                        }
                        Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
                state.ipc.remove(id);
                Ok(PostAction::Remove)
            },
        );
        if let Err(error) = inserted {
            tracing::warn!(%error, "IPC connection");
            self.ipc.remove(id);
        }
    }

    fn ipc_line(&mut self, id: ConnectionId, line: &str) {
        match frame::parse_request(line) {
            Ok(request) => {
                let request_id = request.id;
                let outcome = requests::handle(self, id, request);
                self.ipc.send(id, &frame::reply(request_id, outcome));
            }
            Err(frame::Malformed {
                id: Some(request_id),
                error,
            }) => self.ipc.send(id, &frame::reply(request_id, Err(error))),
            Err(frame::Malformed { id: None, error }) => {
                tracing::debug!(%error, "IPC: dropped a line that is not a request")
            }
        }
    }
}
