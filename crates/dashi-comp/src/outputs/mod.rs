//! Screens as the shell sees them (`outputs`), and the changes it asks for
//! (`output`). C2 adds whole arrangements (`outputs-config`); one screen
//! may show another's picture (`mirror`).

mod config;
mod mirror;
mod report;
mod vrr;

pub(crate) use config::OutputsConfig;
pub(crate) use mirror::{
    BAR as MIRROR_BAR, MirrorParams, Mirrors, bars as mirror_bars, drawn_size, letterbox,
};
pub(crate) use report::{ShownTransform, describe_all, set_scale};
pub(crate) use vrr::VrrMode;
