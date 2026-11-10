//! Every event the compositor sends a subscribed connection
//! (docs/compositor-ipc.md, "Events"), one variant each: `{"event": "<name>", ...}`.

use serde::Serialize;

use super::window::{At, Frame, State, Window};

/// What a person did with a window's square (the only control the shell decides).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Control {
    Zoom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Grab {
    Move,
    Resize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SuperPhase {
    Tap,
    Hold,
    Chord,
    Up,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ScreenEdge {
    Left,
    Right,
    Top,
    Bottom,
}

/// The only edge `edges` claims.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Bottom {
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Swipe {
    Swipe,
}

/// A claimed swipe, as it goes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub(crate) enum SwipePhase {
    Begin { fingers: u32 },
    Update { dx: f64, dy: f64 },
    End { cancelled: bool },
}

/// A point in a `window-placing` (whole logical pixels).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct Position {
    pub x: i32,
    pub y: i32,
}

/// A new window, before it shows: the shell answers with `place` or `frame`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Placing {
    pub id: u64,
    pub app_id: String,
    pub title: String,
    pub width: i32,
    pub height: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<Position>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "event",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum Event {
    WindowOpened {
        window: Window,
    },
    WindowClosed {
        id: u64,
    },
    WindowPlacing {
        window: Placing,
    },
    WindowAttention {
        window: u64,
    },
    WindowSpace {
        window: u64,
        space: usize,
    },
    WindowState {
        window: u64,
        state: State,
    },
    Zoom {
        window: u64,
        on: bool,
    },
    WindowControl {
        window: u64,
        control: Control,
        alt: bool,
        double: bool,
    },
    WindowGrab {
        window: u64,
        kind: Grab,
        frame: Frame,
        pointer: At,
    },
    WindowDrop {
        window: u64,
        zone: usize,
        frame: Frame,
    },
    Fullscreen {
        window: u64,
        on: bool,
    },
    Shortcut {
        name: String,
    },
    Binding {
        name: String,
        window: Option<u64>,
        key: String,
        shift: bool,
        ctrl: bool,
        alt: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        text: Option<String>,
    },
    Super {
        phase: SuperPhase,
    },
    BarsEdge {
        inside: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
    Edge {
        edge: Bottom,
        inside: bool,
    },
    OutputsChanged,
    GpusChanged,
    SessionChanged,
    Lock {
        locked: bool,
    },
    ScreenCapture {
        active: bool,
    },
    PersonInput {
        window: Option<u64>,
    },
    Overview {
        active: bool,
    },
    OverviewPick {
        window: Option<u64>,
    },
    OverviewKey {
        key: String,
    },
    OverviewDrag {
        window: u64,
        x: f64,
        y: f64,
    },
    OverviewDrop {
        window: u64,
        x: f64,
        y: f64,
    },
    Space {
        current: usize,
        previous: usize,
        count: usize,
    },
    EdgeHold {
        edge: ScreenEdge,
        output: String,
        window: u64,
        count: u32,
        preview: bool,
    },
    Gesture {
        kind: Swipe,
        #[serde(flatten)]
        phase: SwipePhase,
    },
    Idle {
        seconds: u64,
    },
    Active,
    Wallpaper {
        path: Option<String>,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    WindowIcon {
        window: u64,
        name: Option<String>,
        path: Option<String>,
    },
    Bell {
        window: Option<u64>,
    },
    Selection {
        mime_types: Vec<String>,
        window: Option<u64>,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        x11: bool,
    },
    Snippet {
        keyword: String,
        window: u64,
    },
}
