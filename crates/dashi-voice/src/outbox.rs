//! Where events go: the shell's connection, while it has one.

use std::{
    io::Write,
    os::unix::net::UnixStream,
    sync::{Arc, Mutex},
};

use serde_json::Value;

#[derive(Clone, Default)]
pub(crate) struct Outbox {
    stream: Arc<Mutex<Option<UnixStream>>>,
}

impl Outbox {
    pub(crate) fn connect(&self, stream: UnixStream) {
        if let Ok(mut slot) = self.stream.lock() {
            *slot = Some(stream);
        }
    }

    pub(crate) fn disconnect(&self) {
        if let Ok(mut slot) = self.stream.lock() {
            *slot = None;
        }
    }

    pub(crate) fn send(&self, value: &Value) {
        let mut line = value.to_string();
        line.push('\n');
        let Ok(mut slot) = self.stream.lock() else {
            return;
        };
        if let Some(stream) = slot.as_mut()
            && stream.write_all(line.as_bytes()).is_err()
        {
            *slot = None;
        }
    }
}
