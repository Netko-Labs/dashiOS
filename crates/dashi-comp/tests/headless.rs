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
use support::client::Client;

struct Compositor {
    child: Child,
    dir: tempfile::TempDir,
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
        ipc.request("gamma", json!({}))["error"]
            .as_str()
            .unwrap()
            .contains("not in this dashi-comp yet")
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
fn the_shells_configuration_is_kept_until_its_milestone() {
    let compositor = Compositor::start(&[]);
    let mut ipc = compositor.connect();
    for method in [
        "chrome",
        "layout",
        "gestures",
        "idle",
        "bars",
        "animation-target",
        "screencopy-clients",
    ] {
        assert_eq!(
            ipc.request(method, json!({}))["result"],
            json!({}),
            "{method}"
        );
    }
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
