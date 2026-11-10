//! The IPC's golden fixtures (H9): one request and one reply per method, and
//! one of each event, each read into its Rust type and written back out of
//! it, so what lands in test/fixtures/ipc/ is what the compositor's types
//! accept and send (params with the fields left out absent, as the shell
//! sends them). The shell's tests parse every one with its shapes
//! (packages/shell/test/compositor-contract.test.ts). `cargo test` rewrites
//! the files when they differ, and fails until the new ones are committed.

use std::collections::BTreeMap;

use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use super::{
    methods::{agents::*, capture::*, chrome::*, screens::*, spaces::*, windows::*},
    protocol::*,
    table::METHODS,
};
use crate::{
    handlers::layer_regions::InputRegion,
    input::InputParams,
    keys::{KeyboardParams, KeymapParams},
    outputs::{MirrorParams, OutputsConfig},
    render::{depth::WindowStyle, mask::CaptureMask},
    session::{
        agent_input::AgentInput,
        applets::AppletClientsParams,
        origin::{Origin, OriginParams},
    },
    wm::LayerMotionParams,
};

/// `value` read as a `T` and written back: what the compositor's type makes of it.
fn through<T: DeserializeOwned + Serialize>(value: Value) -> Value {
    let typed: T = read(value).unwrap_or_else(|error| panic!("an example does not read: {error}"));
    write(&typed).expect("a type writes")
}

/// Params as the shell sends them: a field left out is absent, not null.
fn sent(mut value: Value) -> Value {
    match &mut value {
        Value::Object(fields) => {
            fields.retain(|_, field| !field.is_null());
            for field in fields.values_mut() {
                *field = sent(field.take());
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                *item = sent(item.take());
            }
        }
        _ => {}
    }
    value
}

macro_rules! example {
    ($into:ident, $name:literal, $params:ty, $p:expr, $reply:ty, $r:expr) => {
        $into.insert(
            $name,
            json!({ "params": sent(through::<$params>($p)), "reply": through::<$reply>($r) }),
        );
    };
}

#[rustfmt::skip]
fn window() -> Value {
    json!({
        "id": 7, "appId": "dev.dashi.notes", "title": "Notes", "pid": 4242, "focused": true,
        "state": "normal", "frame": { "x": 100, "y": 80, "width": 800, "height": 600 },
        "configuring": null, "minSize": { "width": 300, "height": 200 }, "titleBar": 38,
        "fullscreen": false, "space": 0, "attention": false, "x11": false, "sheetOf": null,
        "parent": null, "icon": { "name": "accessories-text-editor", "path": null },
        "toplevel": "a1b2c3"
    })
}

#[rustfmt::skip]
fn output() -> Value {
    json!({
        "name": "eDP-1", "make": "BOE", "model": "NE160QDM", "serial": "", "enabled": true,
        "lit": true, "mirrorOf": null, "primary": true,
        "physicalMm": { "width": 340, "height": 220 }, "scale": 1.75,
        "transform": { "rotation": 0, "flipped": false },
        "mode": { "width": 2560, "height": 1600, "refreshMhz": 165000 },
        "modes": [{ "width": 2560, "height": 1600, "refreshMhz": 165000, "preferred": true, "current": true }],
        "frame": { "x": 0, "y": 0, "width": 1463, "height": 914 },
        "usable": { "x": 0, "y": 30, "width": 1463, "height": 884 },
        "vrr": { "supported": true, "active": false, "mode": "fullscreen" }
    })
}

#[rustfmt::skip]
fn windows_and_screens(into: &mut BTreeMap<&'static str, Value>) {
    let none = json!({});
    let one = json!({ "window": 7 });
    let switch = json!({ "window": 7, "on": true });
    example!(into, "subscribe", Nothing, none.clone(), Done, none.clone());
    example!(into, "session", Nothing, none.clone(), Session, json!({ "waylandDisplay": "wayland-1", "display": ":1", "xwayland": "ready", "pointer": { "x": 640.5, "y": 400.0 }, "locked": false }));
    example!(into, "windows", Nothing, none.clone(), Windows, json!({ "windows": [window()] }));
    example!(into, "focus", OneWindow, one.clone(), Done, none.clone());
    example!(into, "close", OneWindow, one.clone(), Done, none.clone());
    example!(into, "minimize", OneWindow, one.clone(), Done, none.clone());
    example!(into, "hide", OneWindow, one.clone(), Done, none.clone());
    example!(into, "suspend", Switch, switch.clone(), Done, none.clone());
    example!(into, "frame", FrameParams, json!({ "window": 7, "x": 0, "y": 30, "width": 731, "height": 884, "tiled": true }), Done, none.clone());
    example!(into, "place", Place, json!({ "window": 7, "x": 100, "y": 80, "space": 1 }), Done, none.clone());
    example!(into, "fullscreen", Switch, switch, Done, none.clone());
    example!(into, "send-keys", SendKeys, json!({ "window": 7, "chord": "ctrl+shift+z" }), Done, none.clone());
    example!(into, "animation-target", AnimationTargets, json!({ "targets": [{ "window": 7, "rect": { "x": 600, "y": 860, "width": 48, "height": 48 } }, { "window": 8, "rect": null }] }), Done, none.clone());
    example!(into, "layer-motion", LayerMotionParams, json!({ "namespace": "dashi.launcher", "ms": 160, "scale": 0.96 }), Done, none.clone());
    example!(into, "window-for-handle", Handle, json!({ "handle": "wayland:ab12" }), MaybeWindow, json!({ "window": 7 }));
    example!(into, "attach", Attach, json!({ "window": 9, "parent": 7, "top": 52 }), Done, none.clone());
    example!(into, "outputs", Nothing, none.clone(), Outputs, json!({ "outputs": [output()] }));
    example!(into, "mirror", MirrorParams, json!({ "output": "HDMI-A-1", "source": "eDP-1" }), Done, none.clone());
    example!(into, "output", OutputScale, json!({ "name": "eDP-1", "scale": 1.5 }), Done, none.clone());
    example!(into, "xwayland-scale", Scale, json!({ "scale": 2 }), Done, none.clone());
    example!(into, "cursor-size", CursorSize, json!({ "size": 32 }), Done, none.clone());
    example!(into, "input-region", InputRegion, json!({ "namespace": "dashi.dock", "rects": [{ "x": 400, "y": 0, "width": 660, "height": 72 }] }), Done, none.clone());
    example!(into, "outputs-config", OutputsConfig, json!({ "outputs": [{ "name": "eDP-1", "enabled": true, "position": { "x": 0, "y": 0 }, "mode": { "width": 2560, "height": 1600, "refreshMhz": 165000 }, "transform": { "rotation": 0, "flipped": false }, "scale": 1.75, "vrr": "fullscreen" }], "primary": "eDP-1" }), Done, none.clone());
    example!(into, "power", Power, json!({ "on": false, "output": "eDP-1" }), Done, none.clone());
    example!(into, "gamma", Gamma, json!({ "red": 1, "green": 0.8, "blue": 0.6 }), Done, none.clone());
    example!(into, "gpus", Nothing, none.clone(), Gpus, json!({ "gpus": [{ "card": "card1", "open": true, "draws": true, "kept": false, "screens": ["eDP-1"], "buffers": 0, "answering": true }] }));
    example!(into, "gpu-keep", GpuKeep, json!({ "card": "card0", "on": true }), Done, none.clone());
    example!(into, "wallpaper", WallpaperParams, json!({ "shader": "aurora", "fps": 30, "mode": "fill" }), Done, none);
}

#[rustfmt::skip]
fn chrome_and_spaces(into: &mut BTreeMap<&'static str, Value>) {
    let none = json!({});
    let spaces = json!({ "count": 3, "current": 1 });
    example!(into, "chrome", Chrome, json!({ "dark": true, "radius": 12, "reduceMotion": false }), Done, none.clone());
    example!(into, "window-style", WindowStyle, json!({ "shadow": { "focused": [{ "y": 18, "blur": 40, "spread": -8, "alpha": 0.38 }] }, "edge": { "color": "#0000002b", "width": 1, "filled": false }, "ring": { "on": false }, "fade": 150 }), Done, none.clone());
    example!(into, "keymap", KeymapParams, json!({ "apps": { "terminal": ["foot"] }, "tapMs": 300, "holdMs": 700, "rules": [{ "when": "super+space", "bind": "launcher", "armsAfterTap": true }, { "when": "super+c", "app": "terminal", "send": "ctrl+shift+c" }], "afterTap": [{ "when": "letter", "bind": "type" }], "locked": [{ "when": "super+a", "send": "ctrl+a" }, { "when": "super+*", "swallow": true }] }), Done, none.clone());
    example!(into, "bars", Bars, json!({ "show": true, "output": "eDP-1" }), Done, none.clone());
    example!(into, "edges", Edges, json!({ "bottom": 4, "output": "eDP-1" }), Inside, json!({ "inside": false }));
    example!(into, "layout", Layout, json!({ "zones": [{ "area": { "x": 0, "y": 30, "width": 8, "height": 884 }, "frame": { "x": 0, "y": 30, "width": 731, "height": 884 } }], "dwellMs": 150 }), Done, none.clone());
    example!(into, "gestures", Gestures, json!({ "swipe": [3] }), Done, none.clone());
    example!(into, "idle", Idle, json!({ "timeouts": [120, 300] }), Done, none.clone());
    example!(into, "keyboard", KeyboardParams, json!({ "layout": "us,de", "variant": "", "options": "", "repeatRate": 30, "repeatDelay": 400 }), Done, none.clone());
    example!(into, "input", InputParams, json!({ "touchpad": { "tap": true, "naturalScroll": true, "accelSpeed": 0.3, "clickMethod": "clickfinger", "scrollSpeed": 1.5 }, "mouse": { "accelProfile": "flat" } }), Done, none.clone());
    example!(into, "spaces", SpacesParams, json!({ "count": 3, "follow": true }), SpacesAnswer, spaces.clone());
    example!(into, "space-add", SpaceAdd, json!({ "at": 1 }), SpacesAnswer, json!({ "count": 4, "current": 2, "space": 1 }));
    example!(into, "space-remove", OneSpace, json!({ "space": 2 }), SpacesAnswer, json!({ "count": 2, "current": 1 }));
    example!(into, "space-switch", SpaceSwitch, json!({ "space": 1, "progress": 0.4 }), SpacesAnswer, spaces);
    example!(into, "space-move", SpaceMove, json!({ "window": 7, "space": 2 }), Done, none.clone());
    example!(into, "overview", OverviewParams, json!({ "windows": [{ "id": 7, "rect": { "x": 80, "y": 120, "width": 400, "height": 300 } }] }), Done, none.clone());
    example!(into, "space-previews", SpacePreviews, json!({ "output": "eDP-1", "rects": [{ "space": 0, "x": 20, "y": 40, "w": 160, "h": 100, "screen": "eDP-1" }] }), Done, none.clone());
    example!(into, "window-thumbnails", WindowThumbnails, json!({ "rects": [{ "window": 7, "x": 300, "y": 200, "w": 240, "h": 180 }] }), Done, none);
}

#[rustfmt::skip]
fn agents(into: &mut BTreeMap<&'static str, Value>) {
    let none = json!({});
    example!(into, "capture", CaptureParams, json!({ "path": "/run/user/1000/dashi-agent/shot.png", "window": 7, "cursor": false, "mask": "agent" }), Captured, json!({ "width": 1400, "height": 1050, "scale": 1.75 }));
    example!(into, "screencopy-clients", ScreencopyClients, json!({ "paths": ["/usr/bin/wf-recorder"] }), Done, none.clone());
    example!(into, "applet-clients", AppletClientsParams, json!({ "applets": [{ "pid": 4300, "layerShell": true }] }), Done, none.clone());
    example!(into, "ipc-clients", super::grants::IpcClients, json!({ "clients": [{ "pid": 4400, "methods": ["windows", "focus"] }] }), Done, none.clone());
    example!(into, "agent-input", AgentInput, json!({ "window": 7, "label": "Claude", "pointer": { "x": 120, "y": 40 }, "action": "click", "button": "left", "keys": [{ "text": "hi" }, { "name": "Return" }], "borrow": { "idleMs": 3000 } }), Done, none.clone());
    example!(into, "capture-mask", CaptureMask, json!({ "client": "agent", "windows": [9], "rects": [{ "window": 7, "x": 10, "y": 20, "width": 200, "height": 30 }], "layers": ["dashi.agent-consent"], "pids": [4500], "popups": [7] }), Done, none.clone());
    example!(into, "input-origin", OriginParams, json!({ "namespace": "dashi.agent-consent" }), Origin, json!({ "person": 250, "agent": null }));
    example!(into, "snippets", Snippets, json!({ "keywords": [";sig", ";addr"] }), Done, none.clone());
    example!(into, "snippet-erase", SnippetErase, json!({ "window": 7, "keyword": ";sig" }), Done, none);
}

/// One request and reply per method, by name.
fn methods() -> BTreeMap<&'static str, Value> {
    let mut into = BTreeMap::new();
    windows_and_screens(&mut into);
    chrome_and_spaces(&mut into);
    agents(&mut into);
    into
}

/// One of each event.
#[rustfmt::skip]
fn events() -> Vec<Event> {
    let window: Window = read(window()).expect("the example window reads");
    let frame = Frame { x: 0, y: 30, width: 731, height: 884 };
    let swipe = |phase| Event::Gesture { kind: Swipe::Swipe, phase };
    vec![
        Event::WindowOpened { window },
        Event::WindowClosed { id: 7 },
        Event::WindowPlacing { window: Placing { id: 7, app_id: "dev.dashi.notes".into(), title: "Notes".into(), width: 800, height: 638, position: Some(Position { x: 100, y: 80 }), parent: None } },
        Event::WindowAttention { window: 7 },
        Event::window_space(7, 1),
        Event::state(7, State::Minimized),
        Event::Zoom { window: 7, on: true },
        Event::WindowControl { window: 7, control: Control::Zoom, alt: false, double: true },
        Event::WindowGrab { window: 7, kind: Grab::Move, frame, pointer: At { x: 300.0, y: 95.0 } },
        Event::WindowDrop { window: 7, zone: 0, frame },
        Event::Fullscreen { window: 7, on: true },
        Event::Shortcut { name: "stop-agents".into() },
        Event::binding("launcher".into(), Some(7), "space".into(), [false, false, false], Some(" ".into())),
        SuperPhase::Tap.event(),
        Event::BarsEdge { inside: true, output: Some("eDP-1".into()) },
        Event::Edge { edge: Bottom::Bottom, inside: true },
        Event::OutputsChanged,
        Event::GpusChanged,
        Event::SessionChanged,
        Event::Lock { locked: true },
        Event::ScreenCapture { active: true },
        Event::PersonInput { window: None },
        Event::Overview { active: true },
        Event::OverviewPick { window: Some(7) },
        Event::OverviewKey { key: "Escape".into() },
        Event::overview_drag(7, 300.0, 200.0, false),
        Event::overview_drag(7, 320.0, 210.0, true),
        Event::space(1, 0, 3),
        Event::EdgeHold { edge: ScreenEdge::Left, output: "eDP-1".into(), window: 7, count: 1, preview: true },
        swipe(SwipePhase::Begin { fingers: 3 }),
        swipe(SwipePhase::Update { dx: -12.5, dy: 0.0 }),
        swipe(SwipePhase::End { cancelled: false }),
        Event::Idle { seconds: 300 },
        Event::Active,
        Event::Wallpaper { path: Some("/usr/share/dashi/wallpapers/dusk.png".into()), ok: false, error: Some("no such file".into()) },
        Event::WindowIcon { window: 7, name: Some("accessories-text-editor".into()), path: None },
        Event::Bell { window: Some(7) },
        Event::Selection { mime_types: vec!["text/plain;charset=utf-8".into()], window: Some(7), x11: false },
        Event::Snippet { keyword: ";sig".into(), window: 7 },
    ]
}

/// Write `value` to test/fixtures/ipc/`name` when it differs; false when it did.
fn current(name: &str, value: &Value) -> bool {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test/fixtures/ipc")
        .join(name);
    let text = serde_json::to_string_pretty(value).expect("JSON writes") + "\n";
    if std::fs::read_to_string(&path).ok().as_deref() == Some(text.as_str()) {
        return true;
    }
    #[expect(
        clippy::disallowed_methods,
        reason = "a test writes its fixtures, off any event loop"
    )]
    let written = std::fs::create_dir_all(path.parent().expect("a folder"))
        .and_then(|()| std::fs::write(&path, text));
    written.expect("the fixture writes");
    false
}

#[test]
fn every_method_has_an_example() {
    let methods = methods();
    for method in METHODS {
        assert!(
            methods.contains_key(method.name),
            "{} has no example",
            method.name
        );
    }
    assert_eq!(methods.len(), METHODS.len(), "an example names no method");
}

#[test]
fn the_fixtures_are_current() {
    let methods = methods();
    let table: BTreeMap<&str, Value> = METHODS
        .iter()
        .map(|method| {
            let mut example = methods.get(method.name).cloned().unwrap_or(Value::Null);
            example["who"] = json!(method.who.word());
            (method.name, example)
        })
        .collect();
    let events: Vec<Value> = events()
        .iter()
        .map(|event| write(event).expect("an event writes"))
        .collect();
    let fresh = [
        current("methods.json", &json!(table)),
        current("events.json", &json!(events)),
    ];
    assert!(
        fresh.iter().all(|f| *f),
        "test/fixtures/ipc/ was out of date and is rewritten: commit it"
    );
}
