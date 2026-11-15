//! Xwayland's scale. At 1, X11 apps draw at logical size and are stretched to
//! the screen's scale, soft on a fractional or HiDPI screen. Above 1 (the
//! shell sends the screens' scale), Xwayland's client scale maps X11 pixels to
//! the screen's: outputs look that much bigger to X11, windows get configured
//! in screen pixels, and apps that size themselves from `Xft.dpi` (which the
//! shell sets) draw sharp. smithay converts X11 geometry, input, and outputs
//! for that client; this sets the scale and makes everyone hear about it.

use smithay::{
    utils::{Logical, Rectangle},
    xwayland::{X11Surface, XWaylandClientData},
};

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

    /// A new X11 window's place and size in points. X11Wm reads them with
    /// the scale cut to a whole number (1.75 as 1), so at a fractional scale
    /// a window that asked for 800 pixels was taken for 800 points and, once
    /// placed, made 1400 pixels: 1.75 times what its app asked, and twice
    /// scaled for an app that had sized itself from `Xft.dpi`. Said again
    /// here with the real scale, before anything is configured from it.
    pub(super) fn x11_read_geometry(&self, surface: &X11Surface) {
        if let Some(real) = real_geometry(surface.geometry(), self.xwayland.scale) {
            let _ = surface.configure(real);
        }
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

/// What `read` (pixels over the scale's whole part) is in points; None when it is right already.
fn real_geometry(read: Rectangle<i32, Logical>, scale: f64) -> Option<Rectangle<i32, Logical>> {
    let cut = scale.trunc();
    if cut == scale {
        return None;
    }
    let real = |v: i32| (f64::from(v) * cut / scale).round() as i32;
    Some(Rectangle::new(
        (real(read.loc.x), real(read.loc.y)).into(),
        (real(read.size.w).max(1), real(read.size.h).max(1)).into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::real_geometry;
    use smithay::utils::Rectangle;

    #[test]
    fn a_window_of_800_pixels_is_457_points_at_one_and_three_quarters() {
        let read = Rectangle::new((560, 300).into(), (800, 600).into());
        let real = Rectangle::new((320, 171).into(), (457, 343).into());
        assert_eq!(real_geometry(read, 1.75), Some(real));
    }

    #[test]
    fn whole_scales_were_read_right() {
        let read = Rectangle::new((0, 0).into(), (400, 300).into());
        assert_eq!(real_geometry(read, 1.0), None);
        assert_eq!(real_geometry(read, 2.0), None);
        // 2.5 was cut to 2: 1000 pixels read as 500 points are 400.
        let wide = Rectangle::new((0, 0).into(), (500, 500).into());
        assert_eq!(
            real_geometry(wide, 2.5).map(|r| r.size),
            Some((400, 400).into())
        );
    }
}
