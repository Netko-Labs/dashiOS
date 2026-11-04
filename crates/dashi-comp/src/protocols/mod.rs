//! Protocols smithay does not carry (or not as Dashi needs them): Dashi's own
//! (crates/dashi-comp/protocols/), wlr's, and the ext capture family.

pub(crate) mod dashi_chrome;
pub(crate) mod foreign_toplevel;
pub(crate) mod image_capture;
pub(crate) mod screencopy;
pub(crate) mod toplevel_list;
