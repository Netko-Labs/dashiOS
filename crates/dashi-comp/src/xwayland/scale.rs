//! Xwayland's scale. At 1, X11 apps draw at logical size and are stretched to
//! the screen's scale, soft on a fractional or HiDPI screen. Above 1 (the
//! shell sends the screens' scale), Xwayland's client scale maps X11 pixels to
//! the screen's: outputs look that much bigger to X11, windows get configured
//! in screen pixels, and apps that size themselves from `Xft.dpi` (which the
//! shell sets) draw sharp. smithay converts X11 geometry, input, and outputs
//! for that client; this sets the scale and makes everyone hear about it.

use smithay::xwayland::XWaylandClientData;

use crate::state::Dashi;

/// The scales the shell may ask for (the screens' range).
const RANGE: std::ops::RangeInclusive<f64> = 1.0..=4.0;

impl Dashi {
    /// IPC `xwayland-scale {scale}`.
    pub(crate) fn set_xwayland_scale(&mut self, scale: f64) -> Result<(), String> {
        if !scale.is_finite() || !RANGE.contains(&scale) {
            return Err(format!(
                "xwayland-scale: `scale` must be from {} to {}",
                RANGE.start(),
                RANGE.end()
            ));
        }
        if self.xwayland.scale == scale {
            return Ok(());
        }
        self.xwayland.scale = scale;
        self.apply_xwayland_scale();
        Ok(())
    }

    /// Give Xwayland's client the scale, and resend what depends on it: the
    /// outputs it sees, and every X11 window's size in its pixels.
    pub(super) fn apply_xwayland_scale(&mut self) {
        let Some(data) = self
            .xwayland
            .client
            .as_ref()
            .and_then(|client| client.get_data::<XWaylandClientData>())
        else {
            return;
        };
        data.compositor_state.set_client_scale(self.xwayland.scale);
        for output in self.space.outputs() {
            output.change_current_state(None, None, None, None);
        }
        // The same logical frames, now in the new pixels (geometry is kept logical).
        for entry in self.windows.entries() {
            if let Some(x11) = entry.window.x11_surface()
                && !x11.is_override_redirect()
            {
                let _ = x11.configure(None);
            }
        }
    }
}
