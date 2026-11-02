//! One screen's elements, front to back: the cursor, the overlay and top
//! layers, the windows from the top down (each with its title bar), then the
//! bottom and background layers.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            AsRenderElements, Kind,
            memory::MemoryRenderBufferRenderElement,
            surface::{WaylandSurfaceRenderElement, render_elements_from_surface_tree},
        },
    },
    desktop::layer_map_for_output,
    input::pointer::{CursorImageStatus, CursorImageSurfaceData},
    output::Output,
    utils::{Logical, Physical, Point, Rectangle, Scale},
    wayland::{compositor::with_states, shell::wlr_layer::Layer},
};

use super::{DashiElement, titlebar::Decor};
use crate::state::Dashi;

pub(crate) fn output_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output: &Output,
    with_cursor: bool,
) -> Vec<DashiElement<R>>
where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    let Some(output_geo) = state.space.output_geometry(output) else {
        return Vec::new();
    };
    let scale = Scale::from(output.current_scale().fractional_scale());
    state.refresh_decorations(output.current_scale().integer_scale());

    let mut elements = Vec::new();
    if with_cursor {
        cursor_elements(state, renderer, output_geo, scale, &mut elements);
    }
    let layers = layer_map_for_output(output);
    for layer in [Layer::Overlay, Layer::Top] {
        layer_elements(&layers, layer, renderer, scale, &mut elements);
    }
    for window in state.space.elements().rev() {
        let Some(frame_at) = state.space.element_location(window) else {
            continue;
        };
        let entry = state.windows.by_window(window);
        let decor = entry.map(|entry| entry.decor).unwrap_or(Decor::None);
        let image = entry.and_then(|entry| entry.title_image.as_ref());
        let on_output = |at: Point<i32, Logical>| -> Point<i32, Physical> {
            (at - output_geo.loc).to_physical_precise_round(scale)
        };
        if let (Decor::Unified, Some(image)) = (decor, image) {
            push_memory(renderer, on_output(frame_at), &image.buffer, &mut elements);
        }
        let surface_at = on_output(frame_at - window.geometry().loc);
        elements.extend(
            window
                .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0)
                .into_iter()
                .map(DashiElement::Surface),
        );
        if let (Decor::Standard, Some(image)) = (decor, image) {
            let bar_at = Point::from((frame_at.x, frame_at.y - decor.bar_height()));
            push_memory(renderer, on_output(bar_at), &image.buffer, &mut elements);
        }
    }
    for layer in [Layer::Bottom, Layer::Background] {
        layer_elements(&layers, layer, renderer, scale, &mut elements);
    }
    elements
}

fn push_memory<R>(
    renderer: &mut R,
    at: Point<i32, Physical>,
    buffer: &smithay::backend::renderer::element::memory::MemoryRenderBuffer,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    match MemoryRenderBufferRenderElement::from_buffer(
        renderer,
        at.to_f64(),
        buffer,
        None,
        None,
        None,
        Kind::Unspecified,
    ) {
        Ok(element) => elements.push(DashiElement::Memory(element)),
        Err(error) => tracing::warn!(?error, "drawing the compositor's own image"),
    }
}

fn layer_elements<R>(
    layers: &smithay::desktop::LayerMap,
    layer: Layer,
    renderer: &mut R,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    for surface in layers.layers_on(layer).rev() {
        let Some(geometry) = layers.layer_geometry(surface) else {
            continue;
        };
        let at = geometry.loc.to_physical_precise_round(scale);
        elements.extend(
            surface
                .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, at, scale, 1.0)
                .into_iter()
                .map(DashiElement::Surface),
        );
    }
}

fn cursor_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output_geo: Rectangle<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    let Some(pointer) = state.seat.get_pointer() else {
        return;
    };
    let at = pointer.current_location();
    if !output_geo.to_f64().contains(at) {
        return;
    }
    let local = at - output_geo.loc.to_f64();
    match &state.cursor_status {
        CursorImageStatus::Hidden => {}
        CursorImageStatus::Surface(surface) => {
            let hotspot = with_states(surface, |states| {
                states
                    .data_map
                    .get::<CursorImageSurfaceData>()
                    .and_then(|data| data.lock().ok().map(|data| data.hotspot))
                    .unwrap_or_default()
            });
            let origin = (local - hotspot.to_f64()).to_physical(scale).to_i32_round();
            elements.extend(
                render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
                    renderer,
                    surface,
                    origin,
                    scale,
                    1.0,
                    Kind::Cursor,
                )
                .into_iter()
                .map(DashiElement::Surface),
            );
        }
        CursorImageStatus::Named(icon) => {
            let image = state.cursors.get(icon.name(), scale.x.ceil() as i32);
            let origin = (local - image.hotspot.to_f64()).to_physical(scale);
            if let Ok(element) = MemoryRenderBufferRenderElement::from_buffer(
                renderer,
                origin,
                &image.buffer,
                None,
                None,
                None,
                Kind::Cursor,
            ) {
                elements.push(DashiElement::Memory(element));
            }
        }
    }
}
