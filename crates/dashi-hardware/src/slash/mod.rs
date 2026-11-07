//! The lid's Slash light bar on ASUS laptops (docs/hardware.md, "The Slash
//! bar"): a USB HID device with no kernel driver of its own, driven over
//! hidraw with asusd's protocol. The bar can't be read back and forgets at
//! boot, so the helper keeps what it set and sends it again.

mod bar;
mod device;
mod packet;
mod settings;
#[cfg(test)]
mod tests;

pub(crate) use bar::{Bar, SlashError};
pub(crate) use settings::{Change, Input, Settings};
