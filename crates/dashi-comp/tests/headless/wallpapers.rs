//! Wallpapers and pictures: checked, then shown or cleared.

use std::{io::BufRead, process::Command};

use serde_json::{Value, json};

use super::fixtures::{movable_window, window_named};
use crate::support::compositor::{Compositor, Ipc};

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
    // The entry is made once the window is mapped, a turn of the loop after it is listed: wait for it.
    let start = std::time::Instant::now();
    while !window_named(&mut ipc, id)["toplevel"].is_string() {
        assert!(
            start.elapsed() < std::time::Duration::from_secs(5),
            "the window never named its toplevel entry"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
