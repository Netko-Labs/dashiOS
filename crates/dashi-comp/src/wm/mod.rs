//! Window management mechanics: the registry, placement, frames, grabs. What
//! to do with a window is the shell's decision; this carries it out.

mod actions;
mod by_scale;
mod decor;
mod describe;
mod edge_hold;
mod fullscreen;
mod geometry;
mod layer_motion;
mod motion;
mod overview;
mod zones;
pub(crate) use layer_motion::{LayerMotion, LayerMotionParams};
pub(crate) use motion::Motion;
pub(crate) use zones::Zones;
mod space_list;
mod spaces;
pub(crate) use decor::ChromeStyle;
pub(crate) use edge_hold::EdgeHold;
pub(crate) use fullscreen::Bars;
pub(crate) use overview::Overview;
pub(crate) use spaces::{MAX_SPACES, Spaces};
pub(crate) mod grabs;
mod placement;
mod sheets;
mod windows;

pub(crate) use actions::valid_frame;
pub(crate) use geometry::{away_frame, frame_of, frame_to_be};
pub(crate) use windows::{
    Shown, WindowId, Windows, names, toplevel_surface, window_for_copy, window_id_for_surface,
};
