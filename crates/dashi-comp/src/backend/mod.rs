//! Where the compositor's screens come from. The rest of the compositor sees
//! outputs in the space, and asks the backend only to import client buffers.
//!
//! - `winit`: a window in another compositor (development, `vm/nested-session`)
//! - `headless`: no screens drawn; IPC and protocol tests
//! - `udev`: DRM/KMS and libinput on a real seat (C1)

pub(crate) mod headless;
pub(crate) mod winit;

use smithay::backend::allocator::dmabuf::Dmabuf;

/// Dashi's evening purple behind the windows, until wallpapers (C2).
pub(crate) const BACKGROUND: [f32; 4] = [0.106, 0.082, 0.188, 1.0];

/// The backend in use, owned by the compositor's state.
#[derive(Default)]
pub(crate) enum Backend {
    /// Before a backend is up.
    #[default]
    None,
    Winit(Box<winit::WinitData>),
    Headless,
}

impl Backend {
    /// Switch to virtual terminal `vt` (Ctrl+Alt+F1…F12): only a session on a seat of its own can.
    pub(crate) fn change_vt(&mut self, vt: u32) {
        match self {
            Backend::Winit(_) | Backend::Headless | Backend::None => {
                tracing::debug!(vt, "not switching VTs: this compositor does not own a seat");
            }
        }
    }

    /// Import a client's GPU buffer into the renderer: whether it can be drawn.
    pub(crate) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        match self {
            Backend::Winit(data) => data.import_dmabuf(dmabuf),
            Backend::None | Backend::Headless => false,
        }
    }
}
