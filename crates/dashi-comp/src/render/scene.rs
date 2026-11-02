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
    desktop::{Window, layer_map_for_output},
    input::pointer::{CursorImageStatus, CursorImageSurfaceData},
    output::Output,
    utils::{Logical, Physical, Point, Rectangle, Scale},
    wayland::{compositor::with_states, shell::wlr_layer::Layer},
};

use super::{DashiElement, titlebar::Decor};
use crate::state::Dashi;
use smithay::backend::renderer::element::{
    solid::SolidColorRenderElement, utils::RescaleRenderElement,
};

/// What to draw: an area of the space at a scale, with the layers of one
/// output; for a window capture, that window alone.
pub(crate) struct View<'a> {
    pub area: Rectangle<i32, Logical>,
    pub scale: Scale<f64>,
    pub output: &'a Output,
    pub cursor: bool,
    pub only: Option<Window>,
}

/// A whole screen, as it is shown.
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
    let Some(area) = state.space.output_geometry(output) else {
        return Vec::new();
    };
    let scale = Scale::from(output.current_scale().fractional_scale());
    view_elements(
        state,
        renderer,
        &View {
            area,
            scale,
            output,
            cursor: with_cursor,
            only: None,
        },
    )
}

pub(crate) fn view_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    view: &View<'_>,
) -> Vec<DashiElement<R>>
where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    let output = view.output;
    let Some(output_geo) = state.space.output_geometry(output) else {
        return Vec::new();
    };
    let scale = view.scale;
    let origin = view.area.loc;
    state.refresh_decorations(scale.x.ceil() as i32);

    let mut elements = Vec::new();
    if view.cursor {
        cursor_elements(state, renderer, view.area, scale, &mut elements);
    }
    let layer_offset = output_geo.loc - origin;
    // Locked: the lock screen over the wallpaper, and nothing of the session.
    if state.lock.locked {
        if let Some(lock) = state.lock_surface_on(output) {
            let at = layer_offset.to_physical_precise_round(scale);
            elements.extend(
                render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
                    renderer,
                    lock.wl_surface(),
                    at,
                    scale,
                    1.0,
                    Kind::Unspecified,
                )
                .into_iter()
                .map(DashiElement::Surface),
            );
        }
        if let Some(wallpaper) =
            state
                .wallpaper
                .element(renderer, layer_offset, output_geo.size, scale)
        {
            elements.push(DashiElement::Memory(wallpaper));
        }
        return elements;
    }
    let layers = layer_map_for_output(output);
    if view.only.is_none() {
        let top = state.shows_top_layers(output);
        for layer in [Layer::Overlay, Layer::Top]
            .into_iter()
            .filter(|layer| top || *layer == Layer::Overlay)
        {
            layer_elements(&layers, layer, renderer, layer_offset, scale, &mut elements);
        }
        // Where a dragged window would tile, over the windows.
        if let Some(preview) = state.zones.preview {
            let area = Rectangle::new(
                (preview.loc - origin).to_physical_precise_round(scale),
                preview.size.to_physical_precise_round(scale),
            );
            let shade = smithay::backend::renderer::element::solid::SolidColorBuffer::new(
                area.size.to_logical(1),
                [0.30, 0.45, 0.95, 0.28],
            );
            elements.push(DashiElement::Solid(SolidColorRenderElement::from_buffer(
                &shade,
                area.loc,
                1.0,
                1.0,
                Kind::Unspecified,
            )));
        }
        // Windows flying into the Dock: no longer on screen, still drawn.
        let ghosts: Vec<_> = state
            .motion
            .flights
            .iter()
            .filter_map(|(id, flight)| {
                let entry = state.windows.get(*id)?;
                state
                    .space
                    .element_location(&entry.window)
                    .is_none()
                    .then(|| (entry.window.clone(), *flight))
            })
            .collect();
        for (window, flight) in ghosts {
            overview_window(
                state,
                renderer,
                &window,
                flight.now().0,
                origin,
                scale,
                &mut elements,
            );
        }
    }
    for window in state.space.elements().rev() {
        if view.only.as_ref().is_some_and(|only| only != window) {
            continue;
        }
        let Some(mut frame_at) = state.space.element_location(window) else {
            continue;
        };
        if let Some(offset) = state.slide_offset(state.spaces.current, output_geo.size.w) {
            frame_at += offset;
        }
        if let Some(id) = state.windows.by_window(window).map(|e| e.id)
            && let Some(flight) = state.motion.flights.get(&id).copied()
        {
            overview_window(
                state,
                renderer,
                window,
                flight.now().0,
                origin,
                scale,
                &mut elements,
            );
            continue;
        }
        if state.overview.is_some() {
            if let Some(id) = state.windows.by_window(window).map(|e| e.id)
                && let Some(rect) = state.overview_rect(id)
            {
                overview_window(state, renderer, window, rect, origin, scale, &mut elements);
            }
            continue;
        }
        let entry = state.windows.by_window(window);
        let decor = entry.map(|entry| entry.decor).unwrap_or(Decor::None);
        let image = entry.and_then(|entry| entry.title_image.as_ref());
        let on_view = |at: Point<i32, Logical>| -> Point<i32, Physical> {
            (at - origin).to_physical_precise_round(scale)
        };
        if let (Decor::Unified, Some(image)) = (decor, image) {
            push_memory(renderer, on_view(frame_at), &image.buffer, &mut elements);
        }
        let surface_at = on_view(frame_at - window.geometry().loc);
        elements.extend(
            window
                .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0)
                .into_iter()
                .map(DashiElement::Surface),
        );
        if let (Decor::Standard, Some(image)) = (decor, image) {
            let bar_at = Point::from((frame_at.x, frame_at.y - state.bar_height(window)));
            push_memory(renderer, on_view(bar_at), &image.buffer, &mut elements);
        }
    }
    // The Space sliding in from beside: its windows, from where they wait.
    if let Some(slide) = state.spaces.slide.filter(|_| view.only.is_none())
        && let Some(offset) = state.slide_offset(slide.to, output_geo.size.w)
    {
        let arriving: Vec<_> = state
            .windows
            .entries()
            .filter(|e| e.space == slide.to && e.shown == crate::wm::Shown::Normal)
            .filter_map(|e| e.away_at.map(|at| (e.window.clone(), at)))
            .collect();
        for (window, at) in arriving.into_iter().rev() {
            let surface_at =
                ((at + offset - window.geometry().loc) - origin).to_physical_precise_round(scale);
            elements.extend(
                window
                    .render_elements::<WaylandSurfaceRenderElement<R>>(
                        renderer, surface_at, scale, 1.0,
                    )
                    .into_iter()
                    .map(DashiElement::Surface),
            );
        }
    }
    if view.only.is_some() {
        return elements;
    }
    for layer in [Layer::Bottom, Layer::Background] {
        layer_elements(&layers, layer, renderer, layer_offset, scale, &mut elements);
    }
    // Behind everything: the wallpaper, across this screen.
    if let Some(wallpaper) = state
        .wallpaper
        .element(renderer, layer_offset, output_geo.size, scale)
    {
        elements.push(DashiElement::Memory(wallpaper));
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
    offset: Point<i32, Logical>,
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
        let at = (geometry.loc + offset).to_physical_precise_round(scale);
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
    // The agent's pointer, over everything, while it acts.
    if let Some((at, label)) = state.agent.pointer.clone()
        && output_geo.to_f64().contains(at)
    {
        let s = scale.x.ceil() as i32;
        let fresh = state
            .agent_cursor
            .as_ref()
            .is_none_or(|(l, sc, _)| l != &label || *sc != s);
        if fresh {
            let image = super::cursor::agent_pointer(&label, s, &mut state.text);
            state.agent_cursor = Some((label, s, image));
        }
        if let Some((_, _, image)) = &state.agent_cursor {
            let origin = (at - output_geo.loc.to_f64()).to_physical(scale);
            if let Ok(element) = MemoryRenderBufferRenderElement::from_buffer(
                renderer,
                origin,
                image,
                None,
                None,
                None,
                Kind::Cursor,
            ) {
                elements.push(DashiElement::Memory(element));
            }
        }
    }
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

/// A window drawn small where the overview puts it (`rect`: its outer frame there).
fn overview_window<R>(
    state: &Dashi,
    renderer: &mut R,
    window: &Window,
    rect: Rectangle<f64, Logical>,
    origin: Point<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem,
    R::TextureId: Clone + Send + 'static,
{
    let geometry = window.geometry();
    let bar = f64::from(state.bar_height(window));
    let outer_w = f64::from(geometry.size.w.max(1));
    let s = rect.size.w / outer_w;
    let inner = rect.loc + Point::from((0.0, bar * s));
    // Drawn at full size at its small spot, then shrunk about that spot (popups and subsurfaces too).
    let surface_at = (inner - geometry.loc.to_f64() - origin.to_f64())
        .to_physical(scale)
        .to_i32_round();
    let about = (inner - origin.to_f64()).to_physical(scale).to_i32_round();
    elements.extend(
        window
            .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0)
            .into_iter()
            .map(|element| {
                DashiElement::Scaled(RescaleRenderElement::from_element(element, about, s))
            }),
    );
    let image = state
        .windows
        .by_window(window)
        .and_then(|entry| entry.title_image.as_ref());
    if let Some(image) = image.filter(|_| bar > 0.0) {
        let at = (rect.loc - origin.to_f64()).to_physical(scale);
        let size = smithay::utils::Size::from((
            (rect.size.w).round() as i32,
            (bar * s).round().max(1.0) as i32,
        ));
        if let Ok(element) = MemoryRenderBufferRenderElement::from_buffer(
            renderer,
            at,
            &image.buffer,
            None,
            None,
            Some(size),
            Kind::Unspecified,
        ) {
            elements.push(DashiElement::Memory(element));
        }
    }
}
