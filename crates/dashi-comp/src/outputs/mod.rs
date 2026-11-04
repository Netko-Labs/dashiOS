//! Screens as the shell sees them (`outputs`), and the changes it asks for
//! (`output`). C2 adds whole arrangements (`outputs-config`).

mod config;
mod report;
mod vrr;

pub(crate) use report::{ShownTransform, describe_all, set_scale};
pub(crate) use vrr::VrrMode;
