//! The real compositor, headless (no GPU), in a runtime folder of its own,
//! and the shell's side of its IPC socket.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command},
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

pub struct Compositor {
    pub child: Child,
    pub dir: tempfile::TempDir,
    pub socket: PathBuf,
}

impl Compositor {
    pub fn start(extra: &[&str]) -> Self {
        Self::start_with(extra, &[])
    }

    /// Started with these environment variables set too.
    pub fn start_with(extra: &[&str], env: &[(&str, &str)]) -> Self {
        let compositor = Self::spawn_with(extra, env);
        wait_for(&compositor.socket);
        compositor
    }

    /// Started, without waiting for its socket (a session that may already be over).
    pub fn spawn(extra: &[&str]) -> Self {
        Self::spawn_with(extra, &[])
    }

    /// Every connection is the shell's (`--open-ipc`): the test speaks as it.
    pub fn spawn_with(extra: &[&str], env: &[(&str, &str)]) -> Self {
        Self::spawn_as(&[&["--open-ipc"], extra].concat(), env)
    }

    /// Started as a session is: only the session client's processes are the shell.
    pub fn start_session(command: &str) -> Self {
        let compositor = Self::spawn_as(&["-c", command], &[]);
        wait_for(&compositor.socket);
        compositor
    }

    pub fn spawn_as(extra: &[&str], env: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().expect("a temporary runtime folder");
        let socket = dir.path().join("dashi-comp.sock");
        let child = Command::new(env!("CARGO_BIN_EXE_dashi-comp"))
            .args(["--backend", "headless"])
            .args(extra)
            .env("XDG_RUNTIME_DIR", dir.path())
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("DISPLAY")
            .env_remove("DASHI_COMP_SOCKET")
            .env("RUST_LOG", "warn")
            .env_remove("DASHI_AGENT_SEAT")
            .envs(env.iter().copied())
            .spawn()
            .expect("dashi-comp starts");
        Self { child, dir, socket }
    }

    pub fn connect(&self) -> Ipc {
        let stream = UnixStream::connect(&self.socket).expect("the IPC socket answers");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Ipc {
            reader: BufReader::new(stream.try_clone().unwrap()),
            stream,
            next: 0,
            events: Vec::new(),
        }
    }
}

impl Drop for Compositor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Waits until the socket answers. Its file appears at `bind`, a moment
/// before `listen`: on a busy machine a connection made in between is refused.
pub fn wait_for(path: &Path) {
    let start = Instant::now();
    while UnixStream::connect(path).is_err() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "no IPC socket answers at {}",
            path.display()
        );
        sleep(Duration::from_millis(20));
    }
}

pub struct Ipc {
    pub stream: UnixStream,
    pub reader: BufReader<UnixStream>,
    pub next: u64,
    /// Events that arrived while waiting for a reply.
    pub events: Vec<Value>,
}

impl Ipc {
    /// Send a line; the reply to it (events before it are kept in `events`).
    pub fn line(&mut self, text: &str) -> Value {
        writeln!(self.stream, "{text}").unwrap();
        loop {
            let mut line = String::new();
            self.reader.read_line(&mut line).expect("a reply");
            let message: Value = serde_json::from_str(&line).expect("the reply is JSON");
            if message.get("event").is_some() {
                self.events.push(message);
            } else {
                return message;
            }
        }
    }

    pub fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let reply =
            self.line(&json!({ "id": self.next, "method": method, "params": params }).to_string());
        assert_eq!(
            reply["id"],
            json!(self.next),
            "replies answer their request"
        );
        reply
    }
}
