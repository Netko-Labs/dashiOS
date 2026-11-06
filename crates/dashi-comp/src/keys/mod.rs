//! The keyboard: ❖, the shell's keymap, and translated chords.

mod handler;
mod keymap;
mod layout;
mod replay;
mod snippets;
mod super_click;

pub(crate) use handler::Keys;
pub(crate) use keymap::{Chord, Keymap};
