//! The layer-shell surfaces of one layer, with the entrance motion of
//! `layer-motion`.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            AsRenderElements, surface::WaylandSurfaceRenderElement, utils::RescaleRenderElement,
        },
    },
    reexports::wayland_server::Resource,
    utils::{Logical, Point, Scale},
    wayland::shell::wlr_layer::Layer,
};

use crate::{
    render::{DashiElement, rounded::GlesAccess},
    state::Dashi,
};

/// One layer's surfaces; with `state`, a surface coming in with motion (`layer-motion`) is drawn
/// faded and scaled about its top middle, as far as its entrance has got.
pub(super) fn layer_elements<R>(
    layers: &smithay::desktop::LayerMap,
    layer: Layer,
    renderer: &mut R,
    offset: Point<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
    mut state: Option<&mut Dashi>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let now = std::time::Instant::now();
    for surface in layers.layers_on(layer).rev() {
        let Some(geometry) = layers.layer_geometry(surface) else {
            continue;
        };
        let at = (geometry.loc + offset).to_physical_precise_round(scale);
        let drawn =
            surface.render_elements::<WaylandSurfaceRenderElement<R>>(renderer, at, scale, 1.0);
        let step = state.as_deref_mut().and_then(|state| {
            let reduce = state.chrome_style.reduce_motion;
            state
                .layer_motion
                .step(&surface.wl_surface().id(), !drawn.is_empty(), reduce, now)
        });
        let Some(step) = step else {
            elements.extend(drawn.into_iter().map(DashiElement::Surface));
            continue;
        };
        let about = (geometry.loc + offset + Point::from((geometry.size.w / 2, 0)))
            .to_physical_precise_round(scale);
        elements.extend(
            surface
                .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, at, scale, step.alpha)
                .into_iter()
                .map(|element| {
                    DashiElement::Scaled(RescaleRenderElement::from_element(
                        element, about, step.scale,
                    ))
                }),
        );
    }
}
