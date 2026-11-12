//! Params and replies of the Spaces, the overview and live pictures
//! (docs/compositor-ipc.md, "Spaces and overview", "Live pictures"), and of
//! the wallpaper.

use serde::{Deserialize, Serialize};

use super::{Coord, Count, Int, Rect};
use crate::wallpaper::Mode;

/// `space-previews`'s params: pictures of Spaces drawn on `output`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpacePreviews {
    pub output: String,
    pub rects: Vec<PreviewRect>,
}

/// One Space's picture: as screen `screen` (default the `output`) shows it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PreviewRect {
    pub space: Int<0, { crate::wm::MAX_SPACES as i64 - 1 }>,
    pub x: Coord,
    pub y: Coord,
    pub w: Coord,
    pub h: Coord,
    pub screen: Option<String>,
}

/// `window-thumbnails`'s params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WindowThumbnails {
    pub rects: Vec<ThumbnailRect>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ThumbnailRect {
    pub window: Int<0, { i64::MAX }>,
    pub x: Coord,
    pub y: Coord,
    pub w: Coord,
    pub h: Coord,
}

/// `overview`'s params: `windows` (the plan) opens it or lays it out again;
/// without, it closes over `duration` ms.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OverviewParams {
    pub windows: Option<Vec<Placed>>,
    pub duration: Option<Count>,
}

/// Where a window goes in the overview.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Placed {
    pub id: Int<0, { i64::MAX }>,
    pub rect: Rect,
}

/// How many Spaces there are and which shows (`spaces`, `space-switch`,
/// `space-remove`); `space-add` also says the new one's index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SpacesAnswer {
    pub count: usize,
    pub current: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<usize>,
}

impl SpacesAnswer {
    pub(crate) fn new(count: usize, current: usize) -> Self {
        Self {
            count,
            current,
            space: None,
        }
    }
}

/// `wallpaper`'s params (the shell's src/wallpaper/catalog.ts
/// `WallpaperRequest`, or `{paused}`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WallpaperParams {
    pub paused: Option<bool>,
    pub mode: Option<Mode>,
    pub gradient: Option<bool>,
    pub shader: Option<String>,
    pub fps: Option<Count>,
    pub path: Option<String>,
    pub video: Option<String>,
}
