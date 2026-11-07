//! The keyboard: ❖, the shell's keymap, and translated chords.

mod handler;
mod keymap;
mod layout;
mod locked;
mod replay;
mod snippets;

pub(crate) use handler::Keys;
pub(crate) use keymap::{Chord, Keymap};
