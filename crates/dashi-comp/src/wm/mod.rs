//! Window management mechanics: the registry, placement, frames, grabs. What
//! to do with a window is the shell's decision; this carries it out.

mod actions;
mod decor;
mod fullscreen;
mod overview;
mod spaces;
pub(crate) use decor::ChromeStyle;
pub(crate) use fullscreen::Bars;
pub(crate) use overview::Overview;
pub(crate) use spaces::Spaces;
pub(crate) mod grabs;
mod placement;
mod windows;

pub(crate) use actions::valid_frame;
pub(crate) use windows::{Shown, Windows, frame_of, names, rect_json, window_id_for_surface};
