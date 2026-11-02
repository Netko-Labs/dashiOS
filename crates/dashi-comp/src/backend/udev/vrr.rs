//! Variable refresh rate (adaptive sync): the shell picks it per screen
//! (`outputs-config` `vrr`: off, on, or only while a window is full screen
//! there); before each frame the screen's DRM compositor is switched to match.
//! A screen that needs a modeset to switch is never switched on its own (no
//! flicker), so "fullscreen" leaves it off.

use smithay::{backend::drm::VrrSupport, output::Output};

use super::{Screen, UdevData};
use crate::outputs::VrrMode;

/// What a screen can do, as `outputs` reports it.
pub(crate) struct VrrReport {
    pub supported: bool,
    pub active: bool,
}

impl UdevData {
    pub(crate) fn vrr_report(&self, output: &Output) -> Option<VrrReport> {
        let id = *output.user_data().get::<super::ScreenId>()?;
        let screen = self.devices.get(&id.node)?.screens.get(&id.crtc)?;
        let supported = screen.vrr != VrrSupport::NotSupported;
        let active = screen
            .scanout
            .with_compositor(|compositor| compositor.vrr_enabled());
        Some(VrrReport { supported, active })
    }
}

/// Switch `screen` to what `mode` wants now (`fullscreen`: a window is full screen there).
pub(super) fn follow(screen: &Screen, mode: VrrMode, fullscreen: bool) {
    let want = match (mode, screen.vrr) {
        (_, VrrSupport::NotSupported) | (VrrMode::Off, _) => false,
        (VrrMode::On, _) => true,
        (VrrMode::Fullscreen, VrrSupport::Supported) => fullscreen,
        (VrrMode::Fullscreen, _) => false,
    };
    screen.scanout.with_compositor(|compositor| {
        if compositor.vrr_enabled() == want {
            return;
        }
        if let Err(error) = compositor.use_vrr(want) {
            tracing::warn!(?error, want, "switching variable refresh rate");
        }
    });
}
