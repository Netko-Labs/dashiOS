//! Depth between windows: a soft shadow under each window (deeper on the
//! focused one), a hairline just inside its frame, and, when the shell turns
//! it on, a ring outside the focused window's frame instead. The look is the
//! shell's (`window-style`, style.rs); this draws it (element.rs) where the
//! window is drawn (cast.rs), by the arithmetic in geometry.rs.

mod cast;
mod element;
mod geometry;
#[cfg(test)]
mod gpu_tests;
pub(crate) mod style;

pub(crate) use cast::{Cache, Placement, Sides, window_depth};
pub(crate) use element::DepthElement;
pub(crate) use style::{Style, WindowStyle};
