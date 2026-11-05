//! Moving and resizing a window with the pointer (xdg-shell's move/resize requests).

pub(crate) mod move_grab;
pub(crate) mod resize_grab;

pub(crate) use resize_grab::{ResizeEdge, ResizeSurfaceGrab};
