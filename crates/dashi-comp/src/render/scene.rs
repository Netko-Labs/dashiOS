//! One screen's elements, front to back: the cursor, the overlay and top
//! layers, the windows from the top down (each with its title bar, edge, and
//! shadow: windows.rs), then the bottom and background layers.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            AsRenderElements, Element, Kind,
            memory::MemoryRenderBufferRenderElement,
            solid::SolidColorRenderElement,
            surface::{WaylandSurfaceRenderElement, render_elements_from_surface_tree},
            utils::RescaleRenderElement,
        },
    },
    desktop::{Window, layer_map_for_output},
    input::pointer::{CursorImageStatus, CursorImageSurfaceData},
    output::Output,
    reexports::wayland_server::Resource,
    utils::{Logical, Point, Rectangle, Scale},
    wayland::{compositor::with_states, shell::wlr_layer::Layer},
};

use super::{
    DashiElement,
    rounded::GlesAccess,
    windows::{Spot, framed_window, overview_window},
};
use crate::state::Dashi;

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
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let Some(area) = state.space.output_geometry(output) else {
        return Vec::new();
    };
    let scale = Scale::from(output.current_scale().fractional_scale());
    let mut elements = view_elements(
        state,
        renderer,
        &View {
            area,
            scale,
            output,
            cursor: with_cursor,
            only: None,
        },
    );
    // The privacy dot (dot.rs): over everything but the pointer, on the screen only, never in a capture.
    if let Some(dot) = state.privacy_dot.element(renderer, area, area.loc, scale) {
        let under_pointer = elements
            .iter()
            .position(|element| element.kind() != Kind::Cursor)
            .unwrap_or(elements.len());
        elements.insert(under_pointer, DashiElement::Memory(dot));
    }
    elements
}

pub(crate) fn view_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    view: &View<'_>,
) -> Vec<DashiElement<R>>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
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
    let spot = Spot {
        origin,
        scale,
        area: view.area,
        depth: view.only.is_none(),
    };
    // A window dragged in Mission Control: over the shell's Desktops row and
    // its pictures, so the person sees what they carry onto one; drawn here
    // instead of in its place among the windows.
    let dragged = state
        .overview_dragged()
        .filter(|_| view.only.is_none())
        .and_then(|id| {
            Some((
                id,
                state.windows.get(id)?.window.clone(),
                state.overview_rect(id)?,
            ))
        });
    if let Some((_, window, rect)) = &dragged {
        overview_window(state, renderer, window, *rect, &spot, &mut elements);
    }
    if view.only.is_none() {
        // The shell's live pictures, over its panels (super::thumbnails).
        elements.extend(super::thumbnails::thumbnail_elements(
            state, renderer, output, view.area, scale,
        ));
    }
    let layers = layer_map_for_output(output);
    if view.only.is_none() {
        let top = state.shows_top_layers(output);
        for layer in [Layer::Overlay, Layer::Top]
            .into_iter()
            .filter(|layer| top || *layer == Layer::Overlay)
        {
            layer_elements(
                &layers,
                layer,
                renderer,
                layer_offset,
                scale,
                &mut elements,
                Some(&mut *state),
            );
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
                &spot,
                &mut elements,
            );
        }
    }
    let shown: Vec<Window> = state.space.elements().rev().cloned().collect();
    for window in &shown {
        if view.only.as_ref().is_some_and(|only| only != window) {
            continue;
        }
        let Some(mut frame_at) = state.space.element_location(window) else {
            continue;
        };
        // A window held in a move grab stays under the pointer while the Spaces slide (one carried stays put).
        let held = state
            .windows
            .by_window(window)
            .is_some_and(|e| state.goes_along(e.id));
        if let Some(offset) = state
            .slide_offset(state.spaces.current, output_geo.size.w)
            .filter(|_| !held)
        {
            frame_at += offset;
        }
        let id = state.windows.by_window(window).map(|e| e.id);
        if let Some(flight) = id.and_then(|id| state.motion.flights.get(&id).copied()) {
            overview_window(
                state,
                renderer,
                window,
                flight.now().0,
                &spot,
                &mut elements,
            );
            continue;
        }
        if state.overview.is_some() {
            if let Some(id) = id
                && dragged.as_ref().is_none_or(|(held, _, _)| *held != id)
                && let Some(rect) = state.overview_rect(id)
            {
                overview_window(state, renderer, window, rect, &spot, &mut elements);
            }
            continue;
        }
        framed_window(state, renderer, window, frame_at, &spot, &mut elements);
    }
    // The Space sliding in from beside: its windows, from where they wait.
    if let Some(slide) = state.spaces.slide.filter(|_| view.only.is_none())
        && let Some(offset) = state.slide_offset(slide.to, output_geo.size.w)
    {
        let arriving: Vec<_> = state
            .windows
            .waiting_on(slide.to)
            .into_iter()
            .filter_map(|e| e.away_at.map(|at| (e.window.clone(), at)))
            .collect();
        for (window, at) in arriving.into_iter().rev() {
            // Drawn as in its frame (its title bar or lights, its corners, its depth), where it waits.
            framed_window(state, renderer, &window, at + offset, &spot, &mut elements);
        }
    }
    if view.only.is_some() {
        return elements;
    }
    for layer in [Layer::Bottom, Layer::Background] {
        layer_elements(
            &layers,
            layer,
            renderer,
            layer_offset,
            scale,
            &mut elements,
            None,
        );
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

/// One layer's surfaces; with `state`, a surface coming in with motion (`layer-motion`) is drawn
/// faded and scaled about its top middle, as far as its entrance has got.
fn layer_elements<R>(
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

fn cursor_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output_geo: Rectangle<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
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
            let tip = super::cursor::AGENT_TIP;
            let origin =
                (at - output_geo.loc.to_f64() - Point::from((tip, tip))).to_physical(scale);
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
    // An agent acting on the person's seat moves its pointer too: one pointer
    // is drawn there, the agent's, not the app's cursor stacked on it.
    let agent_there = state
        .agent
        .pointer
        .as_ref()
        .is_some_and(|(agent, _)| (agent.x - at.x).abs() < 1.0 && (agent.y - at.y).abs() < 1.0);
    if agent_there {
        return;
    }
    let local = at - output_geo.loc.to_f64();
    let shown = match state.resize_cursor {
        Some(icon) => CursorImageStatus::Named(icon),
        None => state.cursor_status.clone(),
    };
    match &shown {
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
    // A drag's icon, under the pointer (the client placed it with its attach offsets).
    if let Some((icon, offset)) = &state.dnd_icon
        && smithay::reexports::wayland_server::Resource::is_alive(icon)
    {
        let origin = (local + offset.to_f64()).to_physical(scale).to_i32_round();
        elements.extend(
            render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
                renderer,
                icon,
                origin,
                scale,
                1.0,
                Kind::Unspecified,
            )
            .into_iter()
            .map(DashiElement::Surface),
        );
    }
}
