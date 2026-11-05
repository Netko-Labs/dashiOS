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

mod support {
    pub mod client;
}
use support::client::{Client, globals};

struct Compositor {
    child: Child,
    dir: tempfile::TempDir,
    socket: PathBuf,
}

impl Compositor {
    fn start(extra: &[&str]) -> Self {
        Self::start_with(extra, &[])
    }

    /// Started with these environment variables set too.
    fn start_with(extra: &[&str], env: &[(&str, &str)]) -> Self {
        let compositor = Self::spawn_with(extra, env);
        wait_for(&compositor.socket);
        compositor
    }

    /// Started, without waiting for its socket (a session that may already be over).
    fn spawn(extra: &[&str]) -> Self {
        Self::spawn_with(extra, &[])
    }

    fn spawn_with(extra: &[&str], env: &[(&str, &str)]) -> Self {
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

    fn connect(&self) -> Ipc {
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
    /// Events that arrived while waiting for a reply.
    events: Vec<Value>,
}

impl Ipc {
    /// Send a line; the reply to it (events before it are kept in `events`).
    fn line(&mut self, text: &str) -> Value {
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
        ipc.request("agent-input", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("window id")
    );
    assert_eq!(
        ipc.request("focus", json!({ "window": 1 }))["error"],
        "no window 1"
    );
    // Only the shell (the session client and what runs under it) may capture the screen.
    assert_eq!(
        ipc.request("capture", json!({ "path": "/tmp/x.png" }))["error"],
        "capture is only for the shell"
    );
    assert!(
        ipc.request("focus", json!({ "window": "1" }))["error"]
            .as_str()
            .unwrap()
            .contains("window id")
    );
    assert!(
        ipc.request(
            "frame",
            json!({ "window": 1, "x": 0, "y": 0, "width": 0, "height": 10 })
        )["error"]
            .is_string()
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

#[test]
fn the_shells_configuration_is_answered() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("bars", json!({}))["result"], json!({}));
    let portal = json!({ "paths": ["/usr/libexec/xdg-desktop-portal-wlr"] });
    assert_eq!(
        ipc.request("screencopy-clients", portal)["result"],
        json!({})
    );
    assert!(
        ipc.request("screencopy-clients", json!({ "paths": ["relative"] }))["error"].is_string()
    );
    assert_eq!(
        ipc.request("edges", json!({ "bottom": 4 }))["result"],
        json!({ "inside": false })
    );
    assert_eq!(
        ipc.request("spaces", json!({}))["result"],
        json!({ "count": 1, "current": 0 })
    );
}

#[test]
fn screens_are_described_as_the_shell_parses_them() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    let outputs = ipc.request("outputs", json!({}))["result"]["outputs"].clone();
    let screen = &outputs[0];
    assert_eq!(screen["name"], "HEADLESS-1");
    assert_eq!(
        screen["mode"],
        json!({ "width": 1920, "height": 1080, "refreshMhz": 60000 })
    );
    assert_eq!(screen["modes"][0]["current"], true);
    assert_eq!(screen["scale"], 1.0);
    assert_eq!(
        screen["transform"],
        json!({ "rotation": 0, "flipped": false })
    );
    assert_eq!(
        screen["frame"],
        json!({ "x": 0, "y": 0, "width": 1920, "height": 1080 })
    );
    // Nothing has claimed an edge yet: all of it is usable.
    assert_eq!(screen["usable"], screen["frame"]);
    assert_eq!(screen["primary"], true);

    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    assert_eq!(
        ipc.request("output", json!({ "name": "HEADLESS-1", "scale": 2.0 }))["result"],
        json!({})
    );
    assert_eq!(ipc.events, vec![json!({ "event": "outputs-changed" })]);
    let screen = &ipc.request("outputs", json!({}))["result"]["outputs"][0];
    assert_eq!(screen["scale"], 2.0);
    assert_eq!(
        screen["frame"],
        json!({ "x": 0, "y": 0, "width": 960, "height": 540 })
    );

    assert!(
        ipc.request("output", json!({ "name": "HEADLESS-1", "scale": 9.0 }))["error"].is_string()
    );
    assert!(
        ipc.request("output", json!({ "name": "nope", "scale": 1.0 }))["error"]
            .as_str()
            .unwrap()
            .contains("nope")
    );
}

#[test]
fn the_keymap_is_checked_before_it_is_used() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let keymap = json!({
        "apps": { "terminal": ["foot"] },
        "tapMs": 350,
        "holdMs": 800,
        "rules": [
            { "when": "super+q", "bind": "quit-app" },
            { "when": "super+letter", "app": "terminal", "send": "ctrl+shift+key" },
            { "when": "super+BackSpace", "tap": ["shift+Home", "BackSpace"] },
            { "when": "super+ctrl+*", "swallow": true }
        ]
    });
    assert_eq!(ipc.request("keymap", keymap)["result"], json!({}));
    let refused = ipc.request(
        "keymap",
        json!({ "rules": [{ "when": "hyper+q", "bind": "x" }] }),
    );
    assert!(
        refused["error"].as_str().unwrap().contains("hyper"),
        "{refused}"
    );
    assert!(
        ipc.request("send-keys", json!({ "window": 9, "chord": "ctrl+z" }))["error"].is_string()
    );
}

/// Read events until one named `name` arrives (or give up after a while).
fn wait_event(ipc: &mut Ipc, client: &mut Client, name: &str) -> Value {
    if let Some(at) = ipc.events.iter().position(|e| e["event"] == name) {
        return ipc.events.remove(at);
    }
    ipc.stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .unwrap();
    let start = Instant::now();
    loop {
        client.dispatch();
        let mut line = String::new();
        if ipc.reader.read_line(&mut line).is_ok() && !line.is_empty() {
            let event: Value = serde_json::from_str(&line).unwrap();
            if event["event"] == name {
                ipc.stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                return event;
            }
        }
        assert!(start.elapsed() < Duration::from_secs(10), "no {name} event");
    }
}

#[test]
fn a_window_waits_for_the_shell_to_place_it() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();

    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "A test");
    let placing = wait_event(&mut ipc, &mut client, "window-placing");
    let window = &placing["window"];
    assert_eq!(window["appId"], "dev.dashi.test");
    assert_eq!(window["title"], "A test");
    assert_eq!(
        (window["width"].as_i64(), window["height"].as_i64()),
        (Some(320), Some(200))
    );
    let id = window["id"].as_u64().unwrap();
    assert!(
        ipc.request("windows", json!({}))["result"]["windows"]
            .as_array()
            .unwrap()
            .is_empty(),
        "not shown until placed"
    );

    assert_eq!(
        ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }))["result"],
        json!({})
    );
    let opened = wait_event(&mut ipc, &mut client, "window-opened");
    assert_eq!(opened["window"]["id"], id);
    assert_eq!(
        opened["window"]["frame"],
        json!({ "x": 100, "y": 50, "width": 320, "height": 200 })
    );
    assert_eq!(opened["window"]["focused"], true);

    assert_eq!(
        ipc.request("close", json!({ "window": id }))["result"],
        json!({})
    );
    let start = Instant::now();
    while !client.state.closed {
        client.dispatch();
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the client was not asked to close"
        );
    }
}

#[test]
fn with_no_shell_a_window_places_itself() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "foot", "foot");
    let start = Instant::now();
    loop {
        client.dispatch();
        let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
        if let Some(window) = windows.as_array().and_then(|w| w.first()) {
            assert_eq!(window["appId"], "foot");
            assert!(window["frame"].is_object());
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the window was never shown"
        );
        sleep(Duration::from_millis(20));
    }
}

/// Wait for the `wallpaper` event (the compositor tells when one is shown or failed).
fn wallpaper_event(ipc: &mut Ipc) -> Value {
    if let Some(at) = ipc.events.iter().position(|e| e["event"] == "wallpaper") {
        return ipc.events.remove(at);
    }
    let mut line = String::new();
    loop {
        line.clear();
        ipc.reader.read_line(&mut line).expect("a wallpaper event");
        let event: Value = serde_json::from_str(&line).unwrap();
        if event["event"] == "wallpaper" {
            return event;
        }
    }
}

#[test]
fn wallpapers_are_checked_then_shown() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));

    assert!(
        ipc.request(
            "wallpaper",
            json!({ "path": "/no/such.png", "mode": "fill" })
        )["error"]
            .as_str()
            .unwrap()
            .contains("no such file")
    );
    assert!(
        ipc.request("wallpaper", json!({ "path": "relative.png" }))["error"]
            .as_str()
            .unwrap()
            .contains("absolute")
    );
    assert!(
        ipc.request("wallpaper", json!({ "gradient": true, "mode": "tile" }))["error"].is_string()
    );
    assert!(
        ipc.request("wallpaper", json!({ "shader": "plasma", "fps": 30 }))["error"].is_string()
    );

    assert_eq!(
        ipc.request("wallpaper", json!({ "gradient": true, "mode": "fill" }))["result"],
        json!({})
    );
    assert_eq!(
        wallpaper_event(&mut ipc),
        json!({ "event": "wallpaper", "path": null, "ok": true })
    );
    assert_eq!(
        ipc.request(
            "wallpaper",
            json!({ "shader": "tide", "fps": 30, "mode": "fill" })
        )["result"],
        json!({})
    );
    assert_eq!(wallpaper_event(&mut ipc)["ok"], true);
    assert_eq!(
        ipc.request("wallpaper", json!({ "paused": true }))["result"],
        json!({})
    );

    // A real picture decodes on a thread and is announced.
    let picture = compositor.dir.path().join("wall.png");
    let mut encoder = png::Encoder::new(std::fs::File::create(&picture).unwrap(), 4, 2);
    encoder.set_color(png::ColorType::Rgba);
    encoder
        .write_header()
        .unwrap()
        .write_image_data(&[200u8; 4 * 2 * 4])
        .unwrap();
    assert_eq!(
        ipc.request("wallpaper", json!({ "path": picture, "mode": "fit" }))["result"],
        json!({})
    );
    assert_eq!(
        wallpaper_event(&mut ipc),
        json!({ "event": "wallpaper", "path": picture, "ok": true })
    );
}

#[test]
fn a_video_plays_as_the_wallpaper() {
    let compositor = Compositor::start(&[]);
    let video = compositor.dir.path().join("loop.webm");
    let made = Command::new("gst-launch-1.0")
        .args([
            "-q",
            "videotestsrc",
            "num-buffers=20",
            "!",
            "video/x-raw,width=320,height=180",
            "!",
            "vp8enc",
            "!",
            "webmmux",
            "!",
            "filesink",
        ])
        .arg(format!("location={}", video.display()))
        .status();
    if !made.is_ok_and(|status| status.success()) {
        eprintln!("skipping: gst-launch-1.0 with vp8enc is not here to make a test video");
        return;
    }
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    assert_eq!(
        ipc.request("wallpaper", json!({ "video": video, "mode": "fill" }))["result"],
        json!({})
    );
    assert_eq!(
        wallpaper_event(&mut ipc),
        json!({ "event": "wallpaper", "path": video, "ok": true })
    );
}

#[test]
fn full_screen_covers_the_screen_and_gives_the_frame_back() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Full");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": true }))["result"],
        json!({})
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["fullscreen"], true);
    assert_eq!(window["titleBar"], 0);
    assert_eq!(window["frame"]["x"], 0);
    assert_eq!(window["frame"]["y"], 0);

    assert_eq!(
        ipc.request("fullscreen", json!({ "window": id, "on": false }))["result"],
        json!({})
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["fullscreen"], false);
    assert_eq!(
        (window["frame"]["x"].as_i64(), window["frame"]["y"].as_i64()),
        (Some(100), Some(50))
    );

    assert_eq!(
        ipc.request("bars", json!({ "top": 1 }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("bars", json!({ "show": true, "output": "HEADLESS-1" }))["result"],
        json!({})
    );
    assert!(ipc.request("fullscreen", json!({ "window": id }))["error"].is_string());
}

#[test]
fn spaces_keep_their_windows() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Spaced");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    assert_eq!(
        ipc.request("spaces", json!({ "follow": false }))["result"],
        json!({ "count": 1, "current": 0 })
    );
    let added = ipc.request("space-add", json!({}))["result"].clone();
    assert_eq!(added, json!({ "count": 2, "current": 0, "space": 1 }));
    // Adding one says so: the count changed.
    assert_eq!(
        wait_event(&mut ipc, &mut client, "space"),
        json!({ "event": "space", "current": 0, "previous": 0, "count": 2 })
    );

    assert_eq!(
        ipc.request("space-move", json!({ "window": id, "space": 1 }))["result"],
        json!({})
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 1 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(
        (window["space"].as_u64(), window["frame"].is_null()),
        (Some(1), true),
        "off screen on another Space"
    );

    assert_eq!(
        ipc.request("space-switch", json!({ "space": 1 }))["result"]["count"],
        2
    );
    let event = wait_event(&mut ipc, &mut client, "space");
    assert_eq!(
        event,
        json!({ "event": "space", "current": 1, "previous": 0, "count": 2 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(window["frame"]["x"], 100, "back where it was");

    // Fewer Spaces: windows on the ones that go join the last one left.
    assert_eq!(
        ipc.request("spaces", json!({ "count": 1 }))["result"],
        json!({ "count": 1, "current": 0 })
    );
    let window = ipc.request("windows", json!({}))["result"]["windows"][0].clone();
    assert_eq!(
        (window["space"].as_u64(), window["frame"]["x"].as_i64()),
        (Some(0), Some(100))
    );
    assert!(ipc.request("space-switch", json!({ "space": 5 }))["error"].is_string());
    assert!(ipc.request("spaces", json!({ "count": 0 }))["error"].is_string());
}

/// A movable window placed at `x, y`, with the shell listening: its id.
fn movable_window(compositor: &Compositor, ipc: &mut Ipc, x: i64, y: i64) -> (Client, u64) {
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client =
        Client::open_movable(compositor.dir.path(), &display, "dev.dashi.test", "Held");
    let id = wait_event(ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": x, "y": y }));
    wait_event(ipc, &mut client, "window-opened");
    (client, id)
}

/// The person's pointer, moved by an agent borrowing the seat (the person is away).
fn hand(ipc: &mut Ipc, window: u64, x: f64, y: f64, action: &str) -> Value {
    let params = json!({ "window": window, "label": "Test", "pointer": { "x": x, "y": y }, "action": action, "borrow": { "idleMs": 0 } });
    ipc.request("agent-input", params)
}

/// Press in the window until the client has asked to be moved and the compositor holds it.
fn grab(ipc: &mut Ipc, client: &mut Client, window: u64, x: f64, y: f64) {
    assert_eq!(hand(ipc, window, x, y, "press")["result"], json!({}));
    let start = Instant::now();
    while client.state.moves == 0 {
        client.dispatch();
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "the client never asked to move"
        );
        sleep(Duration::from_millis(10));
    }
    // Requests are handled in order with the client's, a little later: let it land.
    sleep(Duration::from_millis(100));
    ipc.request("windows", json!({}));
}

fn window_named(ipc: &mut Ipc, id: u64) -> Value {
    let windows = ipc.request("windows", json!({}))["result"]["windows"].clone();
    windows
        .as_array()
        .and_then(|list| list.iter().find(|w| w["id"] == id).cloned())
        .expect("the window is listed")
}

#[test]
fn windows_are_listed_most_recently_used_first() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut open = |title: &str, x: i64| {
        let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", title);
        let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
            .as_u64()
            .unwrap();
        ipc.request("place", json!({ "window": id, "x": x, "y": 50 }));
        wait_event(&mut ipc, &mut client, "window-opened");
        (client, id)
    };
    let (_a, first) = open("First", 100);
    let (_b, second) = open("Second", 300);
    let (_c, third) = open("Third", 500);
    let order = |ipc: &mut Ipc| -> Vec<u64> {
        ipc.request("windows", json!({}))["result"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["id"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(
        order(&mut ipc),
        vec![third, second, first],
        "the newest has the keyboard"
    );
    ipc.request("focus", json!({ "window": first }));
    assert_eq!(order(&mut ipc), vec![first, third, second]);
    // Minimized windows come after those that show.
    ipc.request("minimize", json!({ "window": first }));
    assert_eq!(order(&mut ipc).last(), Some(&first));
}

#[test]
fn a_held_window_goes_along_when_the_space_changes() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, id) = movable_window(&compositor, &mut ipc, 400, 300);
    ipc.request("chrome", json!({ "reduceMotion": true }));
    ipc.request("space-add", json!({}));
    wait_event(&mut ipc, &mut client, "space");
    // A window already waiting on the Space it will be carried to.
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut other = Client::open(compositor.dir.path(), &display, "dev.dashi.other", "There");
    let there = wait_event(&mut ipc, &mut other, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": there, "x": 300, "y": 200 }));
    wait_event(&mut ipc, &mut other, "window-opened");
    ipc.request("space-move", json!({ "window": there, "space": 1 }));
    wait_event(&mut ipc, &mut other, "window-space");
    ipc.request("focus", json!({ "window": id }));

    grab(&mut ipc, &mut client, id, 40.0, 40.0);
    // Dragged 30 to the right and 20 down.
    assert_eq!(hand(&mut ipc, id, 70.0, 60.0, "move")["result"], json!({}));
    let moved = window_named(&mut ipc, id)["frame"].clone();
    assert_eq!(
        (moved["x"].as_i64(), moved["y"].as_i64()),
        (Some(430), Some(320))
    );

    // The Desktop changes mid-drag (a shortcut, a swipe): the window comes along, still held.
    assert_eq!(
        ipc.request("space-switch", json!({ "space": 1 }))["result"]["count"],
        2
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "window-space"),
        json!({ "event": "window-space", "window": id, "space": 1 })
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "space"),
        json!({ "event": "space", "current": 1, "previous": 0, "count": 2 })
    );
    let carried = window_named(&mut ipc, id);
    assert_eq!(carried["space"], 1);
    assert_eq!(carried["frame"]["x"], 430, "on screen, where it was held");
    // In front of the windows that were there, with the keyboard.
    assert_eq!(carried["focused"], true);
    assert_eq!(window_named(&mut ipc, there)["focused"], false);

    // Still in hand: it follows the pointer on the new Desktop, and stays there when let go.
    // (Points are in the window, which moves with the pointer: 50 in is 10 further right.)
    assert_eq!(hand(&mut ipc, id, 50.0, 40.0, "move")["result"], json!({}));
    assert_eq!(
        hand(&mut ipc, id, 40.0, 40.0, "release")["result"],
        json!({})
    );
    let dropped = window_named(&mut ipc, id);
    assert_eq!(
        (dropped["frame"]["x"].as_i64(), dropped["space"].as_u64()),
        (Some(440), Some(1))
    );

    // Let go, it stays on its Desktop when the person goes back.
    ipc.request("space-switch", json!({ "space": 0 }));
    wait_event(&mut ipc, &mut client, "space");
    let left = window_named(&mut ipc, id);
    assert_eq!(
        (left["space"].as_u64(), left["frame"].is_null()),
        (Some(1), true)
    );
}

#[test]
fn a_window_held_against_an_edge_is_told_after_a_while() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (mut client, id) = movable_window(&compositor, &mut ipc, 0, 300);
    grab(&mut ipc, &mut client, id, 30.0, 40.0);
    // To the screen's left edge (the window's left side is there).
    let began = Instant::now();
    assert_eq!(hand(&mut ipc, id, 0.0, 40.0, "move")["result"], json!({}));
    let hold = wait_event(&mut ipc, &mut client, "edge-hold");
    assert!(
        began.elapsed() >= Duration::from_millis(380),
        "held for 400 ms first"
    );
    assert_eq!(
        hold,
        json!({ "event": "edge-hold", "edge": "left", "output": "HEADLESS-1", "window": id, "count": 1, "preview": false })
    );
    // Still there: told again.
    assert_eq!(wait_event(&mut ipc, &mut client, "edge-hold")["count"], 2);

    // Off the edge, then let go: no more.
    assert_eq!(hand(&mut ipc, id, 60.0, 40.0, "move")["result"], json!({}));
    assert_eq!(
        hand(&mut ipc, id, 60.0, 40.0, "release")["result"],
        json!({})
    );
    ipc.events.retain(|e| e["event"] != "edge-hold");
    sleep(Duration::from_millis(900));
    client.dispatch();
    ipc.request("windows", json!({}));
    assert!(
        ipc.events.iter().all(|e| e["event"] != "edge-hold"),
        "a hold ends when the window leaves the edge"
    );
}

#[test]
fn pictures_are_checked_and_cleared() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let (_client, id) = movable_window(&compositor, &mut ipc, 100, 100);
    let rect = json!({ "window": id, "x": 10, "y": 10, "w": 160, "h": 100 });
    assert_eq!(
        ipc.request("window-thumbnails", json!({ "rects": [rect] }))["result"],
        json!({})
    );
    // A window that closed meanwhile is left out, not an error.
    let gone = json!({ "window": 999, "x": 10, "y": 10, "w": 160, "h": 100 });
    assert_eq!(
        ipc.request("window-thumbnails", json!({ "rects": [gone] }))["result"],
        json!({})
    );
    let flat = json!({ "rects": [{ "window": id, "x": 0, "y": 0, "w": 0, "h": 9 }] });
    assert!(ipc.request("window-thumbnails", flat)["error"].is_string());
    assert_eq!(
        ipc.request("window-thumbnails", json!({ "rects": [] }))["result"],
        json!({})
    );

    let desktops = json!({ "output": "HEADLESS-1", "rects": [{ "space": 0, "x": 100, "y": 40, "w": 192, "h": 108 }] });
    assert_eq!(ipc.request("space-previews", desktops)["result"], json!({}));
    let nowhere = json!({ "output": "DP-9", "rects": [] });
    assert!(ipc.request("space-previews", nowhere)["error"].is_string());
    let beyond = json!({ "output": "HEADLESS-1", "rects": [{ "space": 99, "x": 0, "y": 0, "w": 9, "h": 9 }] });
    assert!(ipc.request("space-previews", beyond)["error"].is_string());
    let elsewhere = json!({ "output": "HEADLESS-1", "rects": [{ "space": 0, "x": 0, "y": 0, "w": 9, "h": 9, "screen": "DP-9" }] });
    assert!(ipc.request("space-previews", elsewhere)["error"].is_string());
    let named = json!({ "output": "HEADLESS-1", "rects": [{ "space": 0, "x": 0, "y": 0, "w": 9, "h": 9, "screen": "HEADLESS-1" }] });
    assert_eq!(ipc.request("space-previews", named)["result"], json!({}));
    let clear = json!({ "output": "HEADLESS-1", "rects": [] });
    assert_eq!(ipc.request("space-previews", clear)["result"], json!({}));
    // Windows name their entry in ext-foreign-toplevel-list (what the share picker answers with).
    assert!(window_named(&mut ipc, id)["toplevel"].is_string());
}

#[test]
fn the_overview_opens_on_a_plan_and_closes() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Over");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    let plan = json!({ "windows": [{ "id": id, "rect": { "x": 200, "y": 200, "width": 160, "height": 100 } }] });
    assert_eq!(ipc.request("overview", plan.clone())["result"], json!({}));
    assert_eq!(
        wait_event(&mut ipc, &mut client, "overview"),
        json!({ "event": "overview", "active": true })
    );
    // Laid out again while open: no second "opened".
    assert_eq!(ipc.request("overview", plan)["result"], json!({}));
    assert_eq!(
        ipc.request("overview", json!({ "duration": 0 }))["result"],
        json!({})
    );
    assert_eq!(
        wait_event(&mut ipc, &mut client, "overview"),
        json!({ "event": "overview", "active": false })
    );

    assert!(ipc.request("overview", json!({ "windows": [{ "id": id }] }))["error"].is_string());
    assert!(ipc.request("overview", json!({ "windows": 3 }))["error"].is_string());
}

#[test]
fn idle_is_told_and_the_claims_are_answered() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    assert_eq!(
        ipc.request("idle", json!({ "timeouts": [1] }))["result"],
        json!({})
    );
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Idle");
    assert_eq!(
        wait_event(&mut ipc, &mut client, "idle"),
        json!({ "event": "idle", "seconds": 1 })
    );

    assert_eq!(
        ipc.request("gestures", json!({ "swipe": [3] }))["result"],
        json!({})
    );
    assert!(ipc.request("idle", json!({}))["error"].is_string());
    assert!(ipc.request("power", json!({}))["error"].is_string());
    assert_eq!(
        ipc.request("power", json!({ "on": false }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("gamma", json!({ "red": 1.0, "green": 0.8, "blue": 0.6 }))["result"],
        json!({})
    );
    assert!(ipc.request("gamma", json!({ "red": 1.0 }))["error"].is_string());
}

#[test]
fn screens_are_arranged_and_windows_fly_to_their_tiles() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));

    let arrangement = json!({ "outputs": [{ "name": "HEADLESS-1", "position": { "x": 100, "y": 0 }, "scale": 1.5 }], "primary": "HEADLESS-1" });
    assert_eq!(
        ipc.request("outputs-config", arrangement)["result"],
        json!({})
    );
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    assert_eq!(
        (
            screen["frame"]["x"].as_i64(),
            screen["scale"].as_f64(),
            screen["primary"].as_bool()
        ),
        (Some(100), Some(1.5), Some(true))
    );
    assert!(
        ipc.request("outputs-config", json!({ "outputs": [{ "name": "nope" }] }))["error"]
            .is_string()
    );
    assert!(
        ipc.request(
            "outputs-config",
            json!({ "outputs": [{ "name": "HEADLESS-1", "transform": { "rotation": 45 } }] })
        )["error"]
            .is_string()
    );
    let off = json!({ "outputs": [{ "name": "HEADLESS-1", "enabled": false }] });
    assert!(
        ipc.request("outputs-config", off)["error"]
            .as_str()
            .unwrap()
            .contains("stay on")
    );

    let zones = json!({ "zones": [{ "area": { "x": 0, "y": 0, "width": 2, "height": 500 }, "frame": { "x": 0, "y": 0, "width": 640, "height": 720 } }], "dwellMs": 300 });
    assert_eq!(ipc.request("layout", zones)["result"], json!({}));
    assert!(ipc.request("layout", json!({ "zones": [{ "area": {} }] }))["error"].is_string());

    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Fly");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 200, "y": 100 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    let tile = json!({ "targets": [{ "window": id, "rect": { "x": 600, "y": 1000, "width": 48, "height": 48 } }] });
    assert_eq!(ipc.request("animation-target", tile)["result"], json!({}));
    assert_eq!(
        ipc.request("minimize", json!({ "window": id }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("windows", json!({}))["result"]["windows"][0]["state"],
        "minimized"
    );
    assert_eq!(
        ipc.request("focus", json!({ "window": id }))["result"],
        json!({})
    );
    assert_eq!(
        ipc.request("windows", json!({}))["result"]["windows"][0]["state"],
        "normal"
    );
}

#[test]
fn an_agent_acts_in_one_window_with_its_own_seat() {
    let compositor = Compositor::start_with(&[], &[("DASHI_AGENT_SEAT", "1")]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Agent");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");

    let click = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "action": "click", "button": "left" });
    assert_eq!(ipc.request("agent-input", click)["result"], json!({}));
    let typed = json!({ "window": id, "label": "Claude", "keys": [{ "text": "Hi!" }, { "name": "Control_L", "state": "down" }, { "name": "a" }, { "name": "Control_L", "state": "up" }] });
    assert_eq!(ipc.request("agent-input", typed)["result"], json!({}));
    let outside = json!({ "window": id, "label": "Claude", "pointer": { "x": 5000, "y": 30 }, "action": "click" });
    assert!(
        ipc.request("agent-input", outside)["error"]
            .as_str()
            .unwrap()
            .contains("outside")
    );
    let busy = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "borrow": { "idleMs": 60000 } });
    assert_eq!(
        ipc.request("agent-input", busy)["error"],
        "the person is using the desktop"
    );
    assert_eq!(
        ipc.request("agent-input", json!({ "release": true }))["result"],
        json!({})
    );
}

#[test]
fn a_plain_client_sees_no_privileged_protocols() {
    for mode in [&[][..], &["--greeter"][..]] {
        let compositor = Compositor::start(mode);
        let mut ipc = compositor.connect();
        let session = ipc.request("session", json!({}))["result"].clone();
        // Headless and greeter mode never start Xwayland.
        assert_eq!(session["xwayland"], "off");
        assert_eq!(session["display"], Value::Null);
        let display = session["waylandDisplay"].as_str().unwrap().to_owned();
        let seen = globals(compositor.dir.path(), &display);
        for modern in [
            "zwp_primary_selection_device_manager_v1",
            "wp_viewporter",
            "wp_fractional_scale_manager_v1",
            "wp_single_pixel_buffer_manager_v1",
            "wp_cursor_shape_manager_v1",
            "zwp_pointer_constraints_v1",
            "zwp_relative_pointer_manager_v1",
            "zwp_pointer_gestures_v1",
            "zwp_idle_inhibit_manager_v1",
            "zwp_keyboard_shortcuts_inhibit_manager_v1",
            "zwp_text_input_manager_v3",
            "wp_security_context_manager_v1",
            // xdg_toplevel_icon_manager_v1 is off for now (handlers/toplevel_meta.rs).
            "xdg_system_bell_v1",
            "zxdg_exporter_v2",
            "zxdg_importer_v2",
        ] {
            assert!(
                seen.iter().any(|g| g == modern),
                "{modern} is missing in {mode:?}"
            );
        }
        for privileged in [
            "zwlr_foreign_toplevel_manager_v1",
            "zwlr_screencopy_manager_v1",
            "ext_data_control_manager_v1",
            "zwlr_data_control_manager_v1",
            "ext_session_lock_manager_v1",
            "zwp_input_method_manager_v2",
            "zwp_virtual_keyboard_manager_v1",
            "ext_image_copy_capture_manager_v1",
            "ext_output_image_capture_source_manager_v1",
            "ext_foreign_toplevel_image_capture_source_manager_v1",
            "ext_foreign_toplevel_list_v1",
        ] {
            assert!(
                !seen.iter().any(|g| g == privileged),
                "{privileged} is shown in {mode:?}"
            );
        }
    }
}

#[test]
fn variable_refresh_rate_is_the_shells_choice() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    // No screen to drive headless: it cannot, and it is off.
    assert_eq!(
        screen["vrr"],
        json!({ "supported": false, "active": false, "mode": "off" })
    );
    let choice = json!({ "outputs": [{ "name": "HEADLESS-1", "vrr": "fullscreen" }] });
    assert_eq!(ipc.request("outputs-config", choice)["result"], json!({}));
    let screen = ipc.request("outputs", json!({}))["result"]["outputs"][0].clone();
    assert_eq!(screen["vrr"]["mode"], "fullscreen");
    let wrong = json!({ "outputs": [{ "name": "HEADLESS-1", "vrr": "sometimes" }] });
    assert!(ipc.request("outputs-config", wrong)["error"].is_string());
}

#[test]
fn without_its_own_seat_an_agent_waits_for_the_person() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    assert_eq!(ipc.request("subscribe", json!({}))["result"], json!({}));
    let display = ipc.request("session", json!({}))["result"]["waylandDisplay"]
        .as_str()
        .unwrap()
        .to_owned();
    // One wl_seat: a second would take single-seat toolkits' keyboards away.
    let seats = globals(compositor.dir.path(), &display)
        .into_iter()
        .filter(|g| g == "wl_seat")
        .count();
    assert_eq!(seats, 1);
    let mut client = Client::open(compositor.dir.path(), &display, "dev.dashi.test", "Agent");
    let id = wait_event(&mut ipc, &mut client, "window-placing")["window"]["id"]
        .as_u64()
        .unwrap();
    ipc.request("place", json!({ "window": id, "x": 100, "y": 50 }));
    wait_event(&mut ipc, &mut client, "window-opened");
    // Just started counts as the person being there: the agent must wait.
    let click = json!({ "window": id, "label": "Claude", "pointer": { "x": 20, "y": 30 }, "action": "click" });
    assert_eq!(
        ipc.request("agent-input", click)["error"],
        "the person is using the desktop"
    );
}

#[test]
fn keyboard_layouts_and_pointer_settings_are_checked_then_used() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    let german =
        json!({ "layout": "de", "variant": "nodeadkeys", "repeatRate": 30, "repeatDelay": 250 });
    assert_eq!(ipc.request("keyboard", german)["result"], json!({}));
    // A layout xkb does not know is refused, and the keyboard keeps the last.
    let unknown = json!({ "layout": "no-such-layout" });
    assert!(ipc.request("keyboard", unknown)["error"].is_string());
    let odd = json!({ "layout": "us; rm" });
    assert!(ipc.request("keyboard", odd)["error"].is_string());
    // Back to the system's own.
    assert_eq!(
        ipc.request("keyboard", json!({ "layout": "", "variant": "" }))["result"],
        json!({})
    );

    let input = json!({
        "touchpad": { "tap": true, "naturalScroll": true, "accelSpeed": 0.3, "clickMethod": "clickfinger", "scrollSpeed": 1.5 },
        "mouse": { "accelProfile": "flat" }
    });
    assert_eq!(ipc.request("input", input)["result"], json!({}));
    let wrong = json!({ "mouse": { "accelSpeed": 3 } });
    assert!(ipc.request("input", wrong)["error"].is_string());
}

#[test]
fn nothing_of_a_session_outlives_its_compositor() {
    let out = tempfile::tempdir().unwrap();
    let pid_file = out.path().join("pid");
    // The client starts something in the background (as the shell starts its
    // own processes), then waits.
    let command = format!("sleep 300 & echo $! > '{}'; wait", pid_file.display());
    let mut compositor = Compositor::start(&["-c", &command]);
    let start = Instant::now();
    while !pid_file.exists()
        || std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .is_empty()
    {
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "the client never started"
        );
        sleep(Duration::from_millis(20));
    }
    let pid: i32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let alive = |pid: i32| {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
            && !std::fs::read_to_string(format!("/proc/{pid}/stat"))
                .unwrap_or_default()
                .contains(") Z ")
    };
    assert!(alive(pid));

    // The compositor stops (as at logout): the background process goes with it.
    rustix::process::kill_process(
        rustix::process::Pid::from_raw(compositor.child.id() as i32).unwrap(),
        rustix::process::Signal::TERM,
    )
    .unwrap();
    let _ = compositor.child.wait();
    let start = Instant::now();
    while alive(pid) {
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "a session process outlived the compositor"
        );
        sleep(Duration::from_millis(20));
    }
}

#[test]
fn portal_parents_and_sheets_are_checked() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();

    // A handle nobody exported, or one of no kind the portal passes, names no window.
    for handle in [
        "wayland:nothing-exported-this",
        "x11:3e00004",
        "x11:zz",
        "other:1",
        "",
    ] {
        assert_eq!(
            ipc.request("window-for-handle", json!({ "handle": handle }))["result"],
            json!({ "window": null }),
            "{handle}"
        );
    }
    assert!(
        ipc.request("window-for-handle", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("handle")
    );
    assert_eq!(
        ipc.request("attach", json!({ "window": 1, "parent": 2 }))["error"],
        "no window 1"
    );
    assert!(
        ipc.request("attach", json!({ "window": 1, "parent": "2" }))["error"]
            .as_str()
            .unwrap()
            .contains("parent")
    );
}
