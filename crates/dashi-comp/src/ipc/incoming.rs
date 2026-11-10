//! A connection's side of the socket: its lines read on the event loop as
//! they come, each request checked against who may ask it, then run.

use std::{
    io::{ErrorKind, Read},
    os::unix::net::UnixStream,
};

use smithay::reexports::calloop::{Interest, Mode, PostAction, generic::Generic};

use super::{
    frame::{self, LineBuffer},
    peer,
    server::ConnectionId,
    table::{self, Ask, Run},
};
use crate::state::Dashi;

impl Dashi {
    pub(super) fn ipc_accept(&mut self, stream: UnixStream) {
        let writer = match stream
            .set_nonblocking(true)
            .and_then(|()| stream.try_clone())
        {
            Ok(writer) => writer,
            Err(error) => return tracing::warn!(%error, "IPC connection"),
        };
        let peer = peer::identify(&stream, self.session_client, self.ipc.open);
        let id = self.ipc.add(writer, peer);
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
                                    // Dropped (too far behind): nothing more it sent is run.
                                    if !state.ipc.is_open(id) {
                                        return Ok(PostAction::Remove);
                                    }
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
        if !self.ipc.is_open(id) {
            return;
        }
        self.wakes.poke();
        match frame::parse_request(line) {
            Ok(request) => {
                let ask = Ask {
                    connection: id,
                    id: request.id,
                    params: request.params,
                };
                let outcome = match table::find(&request.method) {
                    None => Err(format!("unknown method: {}", request.method)),
                    Some(method) if !self.ipc.may(id, method.name, method.who) => {
                        Err(table::refusal(method.name, method.who))
                    }
                    Some(method) => match method.run {
                        Run::Now(run) => run(self, &ask),
                        Run::Later(run) => match run(self, &ask) {
                            Ok(()) => return,
                            Err(error) => Err(error),
                        },
                    },
                };
                self.ipc.reply(id, ask.id, outcome);
            }
            Err(frame::Malformed {
                id: Some(request_id),
                error,
            }) => self.ipc.reply(id, request_id, Err(error)),
            Err(frame::Malformed { id: None, error }) => {
                tracing::debug!(%error, "IPC: dropped a line that is not a request")
            }
        }
    }
}
