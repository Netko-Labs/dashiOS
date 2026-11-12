//! Where the compositor's screens come from. The rest of the compositor sees
//! outputs in the space, and asks the backend only to import client buffers.
//!
//! - `winit`: a window in another compositor (development, `vm/nested-session`)
//! - `headless`: no screens drawn; IPC and protocol tests
//! - `udev`: DRM/KMS and libinput on a seat of its own

pub(crate) mod headless;
pub(crate) mod udev;
pub(crate) mod winit;

mod in_use;

pub(crate) use in_use::{BACKGROUND, Backend, capture, capture_mirror, import_dmabuf};
