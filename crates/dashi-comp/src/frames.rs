//! Frame callbacks: after a screen's turn, the clients on it hear to draw the next.

use smithay::desktop::{layer_map_for_output, utils::surface_primary_scanout_output};

use crate::state::Dashi;

impl Dashi {
    /// A dark screen's turn (backend/udev/pace.rs): nothing is drawn, so no
    /// surface gets it as its primary screen; every window on it hears, a
    /// window opened since included, then the rest as `send_frames` tells them.
    pub(crate) fn send_frames_dark(&self, output: &smithay::output::Output) {
        let elapsed = self.start_time.elapsed();
        for window in self.space.elements_for_output(output) {
            window.send_frame(output, elapsed, None, |_, _| Some(output.clone()));
        }
        self.send_frames(output);
    }

    /// Tell every client shown on `output` that a frame went out, so it draws the next.
    pub(crate) fn send_frames(&self, output: &smithay::output::Output) {
        self.send_preferred_scales(output);
        let elapsed = self.start_time.elapsed();
        // Surfaces another screen shows (or none) still hear about once a second.
        let throttle = Some(std::time::Duration::from_secs(1));
        self.space.elements().for_each(|window| {
            window.send_frame(output, elapsed, throttle, surface_primary_scanout_output);
        });
        // Off screen but in a live picture (render/thumbnails/): they draw on, at the screen's pace.
        for window in self.pictured_off_screen() {
            window.send_frame(output, elapsed, None, |_, _| Some(output.clone()));
        }
        for layer in layer_map_for_output(output).layers() {
            layer.send_frame(output, elapsed, throttle, surface_primary_scanout_output);
        }
        if let Some(lock) = self.lock_surface_on(output) {
            smithay::desktop::utils::send_frames_surface_tree(
                lock.wl_surface(),
                output,
                elapsed,
                throttle,
                |_, _| Some(output.clone()),
            );
        }
        if let smithay::input::pointer::CursorImageStatus::Surface(surface) = &self.cursor_status {
            smithay::desktop::utils::send_frames_surface_tree(
                surface,
                output,
                elapsed,
                throttle,
                |_, _| Some(output.clone()),
            );
        }
    }
}
