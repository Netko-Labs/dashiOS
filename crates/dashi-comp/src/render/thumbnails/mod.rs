//! Live, scaled pictures the shell places: each Desktop's windows and
//! wallpaper in Mission Control's row (`space-previews`), and windows in the
//! app switcher, the share picker and the launcher (`window-thumbnails`). The shell says
//! where each picture goes (global logical rects); dashi-comp draws it there,
//! in front of the shell's own surfaces (its panels are opaque, so the
//! pictures can't be under them) and behind the pointer, every frame while
//! the rects are set, until the shell sends empty ones. What a picture means
//! and where it goes is the shell's (packages/shell/src/spaces/,
//! switcher/); this only draws.

mod draw;
mod element;
mod place;
mod requests;
mod store;

pub(crate) use draw::thumbnail_elements;
pub(crate) use element::Thumb;
pub(crate) use place::{fit, on_preview};
pub(crate) use store::Thumbnails;
