//! What each screen's frames cost, as `frame-stats` says it
//! (docs/compositor-ipc.md, "Screens"; decisions.md D510).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FrameStats {
    pub screens: Vec<ScreenFrames>,
}

/// One screen, over its last whole 10 s window (or the one under way).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ScreenFrames {
    pub output: String,
    /// The card that draws its frames, and the one that shows them.
    pub drawn_by: String,
    pub shown_by: String,
    /// `one-gpu`, `gpu-copy`, `cpu-copy` or `unknown`.
    pub path: String,
    pub refresh_mhz: i32,
    pub vrr: bool,
    pub seconds: f64,
    pub frames: u32,
    pub late: u32,
    pub missed_vblanks: u32,
    pub idle: u32,
    pub failed: u32,
    pub waited: u32,
    pub compose_ms: Spread,
    pub commit_ms: Spread,
    /// Null while the GPUs are not timed (one GPU, without `DASHI_FRAME_STATS=1`).
    pub gpu_ms: Option<Spread>,
    pub flip_ms: Spread,
    /// How long after a vblank it starts drawing now.
    pub start_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Spread {
    pub mean: f64,
    pub max: f64,
}
