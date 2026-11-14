//! A window and a frame as the IPC says them (docs/compositor-ipc.md, `Window`
//! and `Frame`): in the `windows` reply and the window events.

use serde::{Deserialize, Serialize};
use smithay::utils::{Logical, Rectangle, Size};

use super::Coord;

/// An outer frame (title bar included), global logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Frame {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl From<Rectangle<i32, Logical>> for Frame {
    fn from(rect: Rectangle<i32, Logical>) -> Self {
        Self {
            x: rect.loc.x,
            y: rect.loc.y,
            width: rect.size.w,
            height: rect.size.h,
        }
    }
}

/// A size in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Extent {
    pub width: i32,
    pub height: i32,
}

impl From<Size<i32, Logical>> for Extent {
    fn from(size: Size<i32, Logical>) -> Self {
        Self {
            width: size.w,
            height: size.h,
        }
    }
}

/// A point in global logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct At {
    pub x: f64,
    pub y: f64,
}

/// Whether a window shows, as the shell sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum State {
    Normal,
    Minimized,
    Hidden,
}

/// What an app gave as its icon (xdg-toplevel-icon).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Icon {
    pub name: Option<String>,
    pub path: Option<String>,
}

/// One window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Window {
    pub id: u64,
    pub app_id: String,
    pub title: String,
    pub pid: Option<i32>,
    pub focused: bool,
    pub state: State,
    pub frame: Option<Frame>,
    /// Its frame where it waits on a Space that does not show; null on screen, minimized or hidden.
    pub away: Option<Frame>,
    pub configuring: Option<Extent>,
    pub min_size: Option<Extent>,
    pub title_bar: i32,
    pub fullscreen: bool,
    pub space: usize,
    pub attention: bool,
    pub x11: bool,
    pub sheet_of: Option<u64>,
    pub parent: Option<u64>,
    pub icon: Option<Icon>,
    pub toplevel: Option<String>,
}

/// A rect the shell sends: global logical pixels, rounded to whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Rect {
    pub x: Coord,
    pub y: Coord,
    pub width: Coord,
    pub height: Coord,
}

impl Rect {
    /// As a rectangle, at least `least` wide and high.
    pub(crate) fn at_least(self, least: i32) -> Rectangle<i32, Logical> {
        Rectangle::new(
            (self.x.i32(), self.y.i32()).into(),
            (self.width.i32().max(least), self.height.i32().max(least)).into(),
        )
    }

    /// As a rectangle, if it has a positive size.
    pub(crate) fn positive(self) -> Option<Rectangle<i32, Logical>> {
        (self.width.get() > 0 && self.height.get() > 0).then(|| self.at_least(1))
    }
}
