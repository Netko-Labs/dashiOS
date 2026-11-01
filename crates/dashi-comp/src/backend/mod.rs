//! Where the compositor's screens come from. The rest of the compositor sees
//! outputs in the space and never a backend's devices.
//!
//! - `winit`: a window in another compositor (development, `vm/dev-session`)
//! - `headless`: no screens drawn; IPC and protocol tests
//! - `udev`: DRM/KMS and libinput on a real seat (C1)

pub(crate) mod headless;
pub(crate) mod winit;

/// Dashi's evening purple behind the windows, until wallpapers (C2).
pub(crate) const BACKGROUND: [f32; 4] = [0.106, 0.082, 0.188, 1.0];
