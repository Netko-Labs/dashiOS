//! The compositor's IPC as the shell speaks it, and waiting on connections.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::support::shell_client::Conn;

/// The compositor's IPC, as the shell speaks it (no `subscribe`: windows place themselves).
pub(super) struct Ipc {
    pub(super) stream: UnixStream,
    pub(super) reader: BufReader<UnixStream>,
    pub(super) next: u64,
}

impl Ipc {
    pub(super) fn connect() -> Self {
        let path = std::env::var("DASHI_COMP_SOCKET").expect("the compositor's socket");
        let stream = UnixStream::connect(path).expect("the IPC socket answers");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Self {
            reader: BufReader::new(stream.try_clone().unwrap()),
            stream,
            next: 0,
        }
    }

    /// The reply: `{result}` or `{error}`.
    pub(super) fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let line = json!({ "id": self.next, "method": method, "params": params });
        writeln!(self.stream, "{line}").unwrap();
        loop {
            let mut line = String::new();
            self.reader.read_line(&mut line).expect("a reply");
            let message: Value = serde_json::from_str(&line).expect("JSON");
            if message.get("event").is_none() {
                return message;
            }
        }
    }

    pub(super) fn refused(&mut self, method: &str, params: Value) -> String {
        let reply = self.request(method, params);
        reply["error"]
            .as_str()
            .unwrap_or_else(|| panic!("{method} was not refused: {reply}"))
            .to_owned()
    }

    pub(super) fn window_id(&mut self, app_id: &str) -> u64 {
        let windows = self.request("windows", json!({}))["result"]["windows"].clone();
        windows
            .as_array()
            .and_then(|all| all.iter().find(|w| w["appId"] == app_id))
            .and_then(|w| w["id"].as_u64())
            .unwrap_or_else(|| panic!("no window of {app_id}: {windows}"))
    }
}

/// Roundtrip `conns` until `done` holds.
pub(super) fn wait_until(conns: &mut [&mut Conn], what: &str, done: impl Fn(&[&mut Conn]) -> bool) {
    let start = Instant::now();
    while !done(conns) {
        assert!(start.elapsed() < Duration::from_secs(10), "never: {what}");
        for conn in conns.iter_mut() {
            conn.roundtrip();
        }
        sleep(Duration::from_millis(10));
    }
}
