//! Window management mechanics: the registry, placement, grabs. Where a
//! window goes is the shell's to decide (C1, `window-placing`); until then new
//! windows cascade.

pub(crate) mod grabs;
mod windows;

pub(crate) use windows::{Windows, describe};
