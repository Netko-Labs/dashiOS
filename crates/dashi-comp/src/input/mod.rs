//! Keyboard and pointer input to the focused client. Adapted from smithay's
//! smallvil example (MIT, github.com/Smithay/smithay, v0.7.0). C1 adds the
//! keymap, bindings, and ❖ (docs/compositor.md).

mod buttons;
mod claims;
mod constraints;
mod decorations;
mod events;
mod follow;
mod gestures;
mod pointer;
mod resize_edges;
pub(crate) mod settings;
pub(crate) mod trackpad;
mod under;

pub(crate) use claims::Claims;
pub(crate) use settings::InputParams;
pub(crate) use trackpad::Pointers;
