//! Where the compositor's screens come from. The rest of the compositor sees
//! outputs in the space, and asks the backend only to import client buffers.
//!
//! - `winit`: a window in another compositor (development, `vm/nested-session`)
//! - `headless`: no screens drawn; IPC and protocol tests
//! - `udev`: DRM/KMS and libinput on a seat of its own

pub(crate) mod headless;
pub(crate) mod udev;
pub(crate) mod winit;

use smithay::backend::allocator::dmabuf::Dmabuf;

use crate::{
    render::{
        View,
        capture::{Picture, render_view},
    },
    state::Dashi,
};

/// Dashi's evening purple behind the windows, until wallpapers (C2).
pub(crate) const BACKGROUND: [f32; 4] = [0.106, 0.082, 0.188, 1.0];

/// The backend in use, owned by the compositor's state.
#[derive(Default)]
pub(crate) enum Backend {
    /// Before a backend is up.
    #[default]
    None,
    Winit(Box<winit::WinitData>),
    Udev(Box<udev::UdevData>),
    Headless,
}

impl Backend {
    /// Switch to virtual terminal `vt` (Ctrl+Alt+F1…F12): only a session on a seat of its own can.
    pub(crate) fn change_vt(&mut self, vt: u32) {
        match self {
            Backend::Udev(data) => data.change_vt(vt),
            Backend::Winit(_) | Backend::Headless | Backend::None => {
                tracing::debug!(vt, "not switching VTs: this compositor does not own a seat");
            }
        }
    }

    /// `gamma`: the screens' tint (None: none).
    pub(crate) fn set_gamma(&mut self, tint: Option<[f64; 3]>) {
        if let Backend::Udev(data) = self {
            data.set_gamma(tint);
        }
    }

    /// A screen's mode (Displays). Only screens the compositor drives have modes to choose.
    pub(crate) fn set_mode(
        &mut self,
        output: &smithay::output::Output,
        mode: smithay::output::Mode,
    ) -> Result<(), String> {
        match self {
            Backend::Udev(data) => data.set_mode(output, mode),
            Backend::Headless => Ok(()),
            Backend::Winit(_) | Backend::None => Err("the nested window keeps its own size".into()),
        }
    }

    /// What a screen can do with variable refresh rate, where the backend knows.
    pub(crate) fn vrr_report(&self, output: &smithay::output::Output) -> Option<udev::VrrReport> {
        match self {
            Backend::Udev(data) => data.vrr_report(output),
            _ => None,
        }
    }

    /// A screen on or off (Displays).
    pub(crate) fn set_enabled(&mut self, output: &smithay::output::Output, enabled: bool) {
        if let Backend::Udev(data) = self {
            data.set_enabled(output, enabled);
        }
    }

    /// Import a client's GPU buffer into the renderer: whether it can be drawn.
    pub(crate) fn import_dmabuf(&mut self, dmabuf: &Dmabuf) -> bool {
        match self {
            Backend::Winit(data) => data.import_dmabuf(dmabuf),
            Backend::Udev(data) => data.import_dmabuf(dmabuf),
            Backend::None | Backend::Headless => false,
        }
    }
}

/// Render `view` offscreen with the backend's renderer (`capture`).
pub(crate) fn capture(state: &mut Dashi, view: &View<'_>) -> Result<Picture, String> {
    let mut backend = std::mem::take(&mut state.backend);
    let result = match &mut backend {
        Backend::Winit(data) => render_view(state, data.renderer(), view),
        Backend::Udev(data) => data.with_renderer(|renderer| render_view(state, renderer, view)),
        Backend::Headless | Backend::None => Err("nothing renders here (headless)".into()),
    };
    state.backend = backend;
    result
}
