//! A screen as the IPC says it: the `outputs` reply (docs/compositor-ipc.md,
//! "Screens"); the shell reads it with one shape (src/compositor/outputs.ts).

use serde::{Deserialize, Serialize};

use super::window::{Extent, Frame};
use crate::outputs::VrrMode;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Outputs {
    pub outputs: Vec<Output>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Output {
    pub name: String,
    pub make: String,
    pub model: String,
    pub serial: String,
    pub enabled: bool,
    pub lit: bool,
    pub mirror_of: Option<String>,
    pub primary: bool,
    pub physical_mm: Extent,
    pub scale: f64,
    pub transform: Rotation,
    pub mode: Option<Mode>,
    pub modes: Vec<ModeInfo>,
    pub frame: Option<Frame>,
    pub usable: Option<Frame>,
    pub vrr: Vrr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Rotation {
    pub rotation: u32,
    pub flipped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Mode {
    pub width: i32,
    pub height: i32,
    pub refresh_mhz: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModeInfo {
    pub width: i32,
    pub height: i32,
    pub refresh_mhz: i32,
    pub preferred: bool,
    pub current: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Vrr {
    pub supported: bool,
    pub active: bool,
    pub mode: VrrMode,
}

/// The GPUs and what holds each open (`gpus`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Gpus {
    pub gpus: Vec<Gpu>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Gpu {
    pub card: String,
    pub open: bool,
    pub draws: bool,
    pub kept: bool,
    pub screens: Vec<String>,
    pub buffers: usize,
    pub answering: bool,
}
