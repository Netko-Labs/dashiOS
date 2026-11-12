//! Events out: every connection that asked (`subscribe`) gets each event as
//! a line. A subscriber that can't be written to is dropped, never waited
//! for: its socket has a short write timeout.

use std::io::Write;
use std::sync::{Arc, Mutex};

use crate::protocol::Event;

/// A connection's writing end, shared by its replies and its events.
pub(crate) type Sink = Arc<Mutex<dyn Write + Send>>;

#[derive(Default)]
pub(crate) struct Hub {
    subscribers: Mutex<Vec<(u64, Sink)>>,
}

/// One line to a sink; false when it could not be written.
pub(crate) fn send(sink: &Sink, line: &str) -> bool {
    let Ok(mut sink) = sink.lock() else {
        return false;
    };
    sink.write_all(line.as_bytes())
        .and_then(|()| sink.write_all(b"\n"))
        .is_ok()
}

impl Hub {
    pub(crate) fn subscribe(&self, connection: u64, sink: Sink) {
        if let Ok(mut subscribers) = self.subscribers.lock()
            && !subscribers.iter().any(|(id, _)| *id == connection)
        {
            subscribers.push((connection, sink));
        }
    }

    pub(crate) fn unsubscribe(&self, connection: u64) {
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.retain(|(id, _)| *id != connection);
        }
    }

    pub(crate) fn emit(&self, event: &Event) {
        let line = event.line();
        // The sinks are written outside the list's lock: a slow one holds nobody else up.
        let sinks: Vec<(u64, Sink)> = match self.subscribers.lock() {
            Ok(subscribers) => subscribers.clone(),
            Err(_) => return,
        };
        for (connection, sink) in sinks {
            if !send(&sink, &line) {
                self.unsubscribe(connection);
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::protocol::State;

    /// A sink that keeps what was written, or refuses everything.
    #[derive(Default)]
    pub(crate) struct Kept {
        pub(crate) bytes: Vec<u8>,
        pub(crate) broken: bool,
    }

    impl Write for Kept {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.broken {
                return Err(std::io::Error::other("gone"));
            }
            self.bytes.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn subscribers_get_events_and_broken_ones_are_dropped() {
        let hub = Hub::default();
        let good = Arc::new(Mutex::new(Kept::default()));
        let bad = Arc::new(Mutex::new(Kept {
            broken: true,
            ..Kept::default()
        }));
        hub.subscribe(1, good.clone());
        hub.subscribe(1, good.clone());
        hub.subscribe(2, bad);
        hub.emit(&Event::State { state: State::Idle });
        hub.emit(&Event::State {
            state: State::Speaking,
        });
        let text = String::from_utf8(good.lock().unwrap().bytes.clone()).unwrap();
        // Subscribed twice, told once.
        assert_eq!(
            text,
            "{\"event\":\"state\",\"state\":\"idle\"}\n{\"event\":\"state\",\"state\":\"speaking\"}\n"
        );
        assert_eq!(hub.subscribers.lock().unwrap().len(), 1);
        hub.unsubscribe(1);
        hub.emit(&Event::Models {});
        assert_eq!(good.lock().unwrap().bytes.len(), text.len());
    }
}
