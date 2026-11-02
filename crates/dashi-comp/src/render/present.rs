//! After a frame is drawn: every surface learns which screen shows most of it
//! (its primary scan-out output, which picks its frame callbacks and its
//! fractional scale), and the frame's presentation-time feedback is gathered,
//! to be told once the frame is on screen (backend/udev: at its vblank).
//! With the screen's dmabuf feedback, each surface hears whether it was
//! scanned out directly, and so which buffer formats suit it best.

use smithay::{
    backend::renderer::element::{
        RenderElementStates, default_primary_scanout_output_compare, utils::select_dmabuf_feedback,
    },
    desktop::{
        layer_map_for_output,
        utils::{
            OutputPresentationFeedback, surface_presentation_feedback_flags_from_states,
            surface_primary_scanout_output, update_surface_primary_scanout_output,
        },
    },
    output::Output,
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    utils::{ClockSource, Monotonic},
    wayland::{dmabuf::DmabufFeedback, presentation::PresentationState},
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
        dmabuf: Option<(&DmabufFeedback, &DmabufFeedback)>,
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

        if let Some((render, scanout)) = dmabuf {
            let select = |surface: &WlSurface, _: &_| {
                select_dmabuf_feedback(surface, states, render, scanout)
            };
            for window in self.space.elements_for_output(output) {
                window.send_dmabuf_feedback(output, surface_primary_scanout_output, select);
            }
            for layer in layers.layers() {
                layer.send_dmabuf_feedback(output, surface_primary_scanout_output, select);
            }
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
