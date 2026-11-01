//! Window management mechanics: the registry, placement, frames, grabs. What
//! to do with a window is the shell's decision; this carries it out.

mod actions;
pub(crate) mod grabs;
mod placement;
mod windows;

pub(crate) use actions::valid_frame;
pub(crate) use windows::{Shown, Windows, rect_json};
