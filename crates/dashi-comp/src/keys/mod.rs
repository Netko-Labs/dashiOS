//! The keyboard: ❖, the shell's keymap, and translated chords.

mod handler;
mod keymap;

pub(crate) use handler::Keys;
pub(crate) use keymap::{Chord, Keymap};
