//! What a surface may say about how it is drawn: viewporter (crop and scale),
//! fractional scale (the scale to draw at), single-pixel buffers, the alpha
//! modifier, and content type. The renderer reads them from the surface state;
//! here they are created, and each surface hears its preferred scale.

use smithay::{
    delegate_alpha_modifier, delegate_content_type, delegate_fractional_scale,
    delegate_single_pixel_buffer, delegate_viewporter,
    desktop::{Window, layer_map_for_output, utils::surface_primary_scanout_output},
    output::Output,
    reexports::wayland_server::{DisplayHandle, protocol::wl_surface::WlSurface},
    wayland::{
        alpha_modifier::AlphaModifierState,
        compositor::{TraversalAction, with_surface_tree_downward},
        content_type::ContentTypeState,
        fractional_scale::{
            FractionalScaleHandler, FractionalScaleManagerState, with_fractional_scale,
        },
        seat::WaylandFocus,
        single_pixel_buffer::SinglePixelBufferState,
        viewporter::ViewporterState,
    },
};

use crate::state::Dashi;

/// Create the globals (they live as long as the display).
pub(crate) fn create_globals(dh: &DisplayHandle) {
    ViewporterState::new::<Dashi>(dh);
    FractionalScaleManagerState::new::<Dashi>(dh);
    SinglePixelBufferState::new::<Dashi>(dh);
    AlphaModifierState::new::<Dashi>(dh);
    ContentTypeState::new::<Dashi>(dh);
}

impl FractionalScaleHandler for Dashi {
    // A first guess; the frames that follow send the scale of the screen it is on.
    fn new_fractional_scale(&mut self, surface: WlSurface) {
        if let Some(output) = self.space.outputs().next() {
            prefer_scale(&surface, output);
        }
    }
}

impl Dashi {
    /// Tell every surface on `output` the scale to draw at (sent only when it changes).
    pub(crate) fn send_preferred_scales(&self, output: &Output) {
        for window in self.space.elements_for_output(output) {
            // A window across two screens draws for the one it is mostly on.
            if self.main_output(window).as_ref() != Some(output) {
                continue;
            }
            if let Some(surface) = window.wl_surface() {
                prefer_scale(&surface, output);
            }
        }
        for layer in layer_map_for_output(output).layers() {
            prefer_scale(layer.wl_surface(), output);
        }
    }

    /// The screen most of `window` is on.
    pub(crate) fn main_output(&self, window: &Window) -> Option<Output> {
        let frame = self.space.element_geometry(window)?;
        self.space
            .outputs_for_element(window)
            .into_iter()
            .max_by_key(|output| {
                self.space
                    .output_geometry(output)
                    .and_then(|screen| screen.intersection(frame))
                    .map_or(0, |overlap| overlap.size.w * overlap.size.h)
            })
    }
}

/// A surface draws for the screen it is mostly on (its primary scanout output), else `output`.
fn prefer_scale(surface: &WlSurface, output: &Output) {
    with_surface_tree_downward(
        surface,
        (),
        |_, _, _| TraversalAction::DoChildren(()),
        |surface, states, _| {
            let primary = surface_primary_scanout_output(surface, states);
            let scale = primary
                .as_ref()
                .unwrap_or(output)
                .current_scale()
                .fractional_scale();
            with_fractional_scale(states, |fractional| fractional.set_preferred_scale(scale));
        },
        |_, _, _| true,
    );
}

delegate_viewporter!(Dashi);
delegate_fractional_scale!(Dashi);
delegate_single_pixel_buffer!(Dashi);
delegate_alpha_modifier!(Dashi);
delegate_content_type!(Dashi);
