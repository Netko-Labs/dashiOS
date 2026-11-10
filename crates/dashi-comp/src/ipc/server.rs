//! The IPC socket (`$XDG_RUNTIME_DIR/dashi-comp.sock`, or `DASHI_COMP_SOCKET`):
//! accepting connections, reading their requests on the event loop, and
//! writing replies and events without ever blocking it.

use std::{
    collections::HashMap,
    io::{self, ErrorKind, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
};

use serde_json::Value;
use smithay::reexports::calloop::{Interest, LoopHandle, Mode, PostAction, generic::Generic};

use super::{frame, grants::Grants, peer::Peer, protocol::Event, table::Who};
use crate::state::Dashi;

/// A client that falls this far behind on reading is dropped instead of buffered forever.
const MAX_BACKLOG: usize = 8 << 20;

pub(crate) type ConnectionId = u64;

struct Connection {
    writer: UnixStream,
    /// Who is on the other end, told when it connected.
    peer: Peer,
    subscribed: bool,
    backlog: Vec<u8>,
}

/// The listening socket and the connected clients' write sides.
pub(crate) struct Ipc {
    path: PathBuf,
    connections: HashMap<ConnectionId, Connection>,
    next_id: ConnectionId,
    /// Every connection is the shell's (`--open-ipc`: tests, a shell started by hand).
    pub open: bool,
    /// The methods the shell granted to other processes (`ipc-clients`).
    pub grants: Grants,
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
                open: false,
                grants: Grants::default(),
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

    pub(super) fn add(&mut self, writer: UnixStream, peer: Peer) -> ConnectionId {
        let id = self.next_id;
        self.next_id += 1;
        self.connections.insert(
            id,
            Connection {
                writer,
                peer,
                subscribed: false,
                backlog: Vec::new(),
            },
        );
        id
    }

    /// Drop `id`: the peer hears the end of the stream, and nothing it sent
    /// after is run (its reader stops at the next line).
    pub(crate) fn remove(&mut self, id: ConnectionId) {
        if let Some(connection) = self.connections.remove(&id) {
            let _ = connection.writer.shutdown(std::net::Shutdown::Both);
        }
    }

    /// Whether `id` is still connected (not dropped).
    pub(crate) fn is_open(&self, id: ConnectionId) -> bool {
        self.connections.contains_key(&id)
    }

    /// Whether the peer on `id` may ask a method that is `who`'s.
    pub(super) fn may(&self, id: ConnectionId, name: &str, who: Who) -> bool {
        let Some(peer) = self.connections.get(&id).map(|c| c.peer) else {
            return who == Who::Anyone;
        };
        match who {
            Who::Anyone => true,
            Who::Shell => peer.shell,
            Who::Granted => peer.shell || peer.pid.is_some_and(|pid| self.grants.allows(pid, name)),
        }
    }

    /// Answer request `request` on `id` (a method that answers later, once done).
    pub(crate) fn reply(&mut self, id: ConnectionId, request: u64, outcome: Result<Value, String>) {
        self.send(id, &frame::reply(request, outcome));
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
    pub(crate) fn emit(&mut self, event: Event) {
        let Some(line) = frame::event(&event) else {
            tracing::warn!(?event, "IPC: an event that does not serialize");
            return;
        };
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
