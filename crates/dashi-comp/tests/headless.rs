//! The compositor as the shell meets it: the real binary, headless (no GPU),
//! in a runtime folder of its own.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command},
    thread::sleep,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

struct Compositor {
    child: Child,
    _dir: tempfile::TempDir,
    socket: PathBuf,
}

impl Compositor {
    fn start(extra: &[&str]) -> Self {
        let compositor = Self::spawn(extra);
        wait_for(&compositor.socket);
        compositor
    }

    /// Started, without waiting for its socket (a session that may already be over).
    fn spawn(extra: &[&str]) -> Self {
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
            .spawn()
            .expect("dashi-comp starts");
        Self {
            child,
            _dir: dir,
            socket,
        }
    }

    fn connect(&self) -> Ipc {
        let stream = UnixStream::connect(&self.socket).expect("the IPC socket answers");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        Ipc {
            reader: BufReader::new(stream.try_clone().unwrap()),
            stream,
            next: 0,
        }
    }
}

impl Drop for Compositor {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn wait_for(path: &Path) {
    let start = Instant::now();
    while !path.exists() {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "no IPC socket at {}",
            path.display()
        );
        sleep(Duration::from_millis(20));
    }
}

struct Ipc {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
    next: u64,
}

impl Ipc {
    fn line(&mut self, text: &str) -> Value {
        writeln!(self.stream, "{text}").unwrap();
        let mut reply = String::new();
        self.reader.read_line(&mut reply).expect("a reply");
        serde_json::from_str(&reply).expect("the reply is JSON")
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
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

#[test]
fn the_shell_can_ask() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));

    let session = &ipc.request("session", json!({}))["result"];
    assert!(
        session["waylandDisplay"]
            .as_str()
            .is_some_and(|name| name.starts_with("wayland-"))
    );
    assert_eq!(session["xwayland"], "off");
    assert!(session["pointer"]["x"].is_number());

    assert_eq!(
        ipc.request("windows", json!({}))["result"],
        json!({ "windows": [] })
    );
}

#[test]
fn mistakes_get_errors_not_a_dropped_connection() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    assert!(
        ipc.request("frobnicate", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("unknown method")
    );
    assert!(
        ipc.request("focus", json!({ "window": 1 }))["error"]
            .as_str()
            .unwrap()
            .contains("not in this dashi-comp yet")
    );
    assert_eq!(
        ipc.line(r#"{"id":40,"method":"windows","params":[1]}"#)["id"],
        40
    );
    // A line that is not a request at all is dropped; the connection still answers.
    writeln!(ipc.stream, "not json").unwrap();
    assert!(ipc.request("windows", json!({}))["result"]["windows"].is_array());
}

#[test]
fn the_session_client_gets_the_sockets_and_ends_the_session() {
    let out = tempfile::tempdir().unwrap();
    let file = out.path().join("env");
    let command = format!(
        "echo \"$WAYLAND_DISPLAY $DASHI_COMP_SOCKET\" > '{}'",
        file.display()
    );
    let mut compositor = Compositor::spawn(&["-c", &command]);

    let start = Instant::now();
    let status = loop {
        if let Some(status) = compositor.child.try_wait().unwrap() {
            break status;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the compositor outlived its client"
        );
        sleep(Duration::from_millis(20));
    };
    assert!(status.success());
    let seen = std::fs::read_to_string(&file).unwrap();
    let mut parts = seen.split_whitespace();
    assert!(
        parts
            .next()
            .is_some_and(|display| display.starts_with("wayland-"))
    );
    assert_eq!(parts.next(), Some(compositor.socket.to_str().unwrap()));
    assert!(
        !compositor.socket.exists(),
        "the socket is removed on the way out"
    );
}

#[test]
fn a_live_socket_is_not_taken_over() {
    let first = Compositor::start(&[]);
    let second = Command::new(env!("CARGO_BIN_EXE_dashi-comp"))
        .args(["--backend", "headless"])
        .env("DASHI_COMP_SOCKET", &first.socket)
        .env("RUST_LOG", "error")
        .output()
        .unwrap();
    assert!(!second.status.success());
    assert!(String::from_utf8_lossy(&second.stdout).contains("another dashi-comp"));
    // The first still answers.
    assert!(first.connect().request("windows", json!({}))["result"].is_object());
}
