//! After a frame is drawn: every surface learns which screen shows most of it
//! (its primary scan-out output, which picks its frame callbacks and its
//! fractional scale), and the frame's presentation-time feedback is gathered,
//! to be told once the frame is on screen (backend/udev: at its vblank).

use smithay::{
    backend::renderer::element::{RenderElementStates, default_primary_scanout_output_compare},
    desktop::{
        layer_map_for_output,
        utils::{
            OutputPresentationFeedback, surface_presentation_feedback_flags_from_states,
            surface_primary_scanout_output, update_surface_primary_scanout_output,
        },
    },
    output::Output,
    reexports::wayland_server::DisplayHandle,
    utils::{ClockSource, Monotonic},
    wayland::presentation::PresentationState,
};

use crate::state::Dashi;

pub(crate) fn create_global(dh: &DisplayHandle) {
    PresentationState::new::<Dashi>(dh, Monotonic::ID as u32);
}

impl Dashi {
    /// Bookkeeping after `output`'s frame (`states`: how each element was shown).
    pub(crate) fn after_render(
        &self,
        output: &Output,
        states: &RenderElementStates,
    ) -> OutputPresentationFeedback {
        let layers = layer_map_for_output(output);
        for window in self.space.elements() {
            window.with_surfaces(|surface, data| {
                update_surface_primary_scanout_output(
                    surface,
                    output,
                    data,
                    states,
                    default_primary_scanout_output_compare,
                );
            });
        }
        for layer in layers.layers() {
            layer.with_surfaces(|surface, data| {
                update_surface_primary_scanout_output(
                    surface,
                    output,
                    data,
                    states,
                    default_primary_scanout_output_compare,
                );
            });
        }

        let mut feedback = OutputPresentationFeedback::new(output);
        for window in self.space.elements_for_output(output) {
            window.take_presentation_feedback(
                &mut feedback,
                surface_primary_scanout_output,
                |surface, _| surface_presentation_feedback_flags_from_states(surface, states),
            );
        }
        for layer in layers.layers() {
            layer.take_presentation_feedback(
                &mut feedback,
                surface_primary_scanout_output,
                |surface, _| surface_presentation_feedback_flags_from_states(surface, states),
            );
        }
        feedback
    }
}

smithay::delegate_presentation!(Dashi);
