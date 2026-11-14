//! One screen's elements, front to back: the cursor, the overlay and top
//! layers, the windows from the top down (each with its title bar, edge, and
//! shadow: windows.rs), then the bottom and background layers.

mod layers;
mod pointer;
mod special;

use smithay::{
    backend::renderer::{ImportAll, ImportMem, Renderer},
    desktop::{Window, layer_map_for_output},
    output::Output,
    utils::{Logical, Rectangle, Scale},
    wayland::shell::wlr_layer::Layer,
};

use self::{layers::layer_elements, pointer::cursor_elements};
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
    /// The scale title bars are drawn at, when not the view's (a mirror's
    /// picture keeps its source's, so they aren't drawn again each frame).
    pub decor_scale: Option<i32>,
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
    // A screen that mirrors another shows that one's picture (outputs/mirror.rs).
    if state.mirrors.of(output).is_some() {
        return super::mirror::mirror_elements(state, renderer, output, with_cursor);
    }
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
            decor_scale: None,
        },
    )
}

/// What `view` shows: an area of the space at a scale, with one output's layers.
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
    state.refresh_decorations(view.decor_scale.unwrap_or(scale.x.ceil() as i32));

    let mut elements = Vec::new();
    if view.cursor {
        cursor_elements(state, renderer, view.area, scale, &mut elements);
    }
    let layer_offset = output_geo.loc - origin;
    // Locked: the lock screen over the wallpaper, and nothing of the session.
    if state.lock.locked {
        special::locked_elements(state, renderer, output, layer_offset, scale, &mut elements);
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
    let layers = layer_map_for_output(output);
    if view.only.is_none() {
        // The shell's live pictures, over its panels (super::thumbnails).
        elements.extend(super::thumbnails::thumbnail_elements(
            state, renderer, output, view.area, scale,
        ));
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
        special::tile_preview(state, origin, scale, &mut elements);
        special::flying_ghosts(state, renderer, &spot, &mut elements);
    }
    let held = dragged.as_ref().map(|(id, _, _)| *id);
    window_elements(
        state,
        renderer,
        view,
        &spot,
        held,
        output_geo.size.w,
        &mut elements,
    );
    // The Space sliding in from beside: its windows, from where they wait.
    if let Some(slide) = state.spaces.slide.filter(|_| view.only.is_none())
        && let Some(offset) = state.slide_offset(slide.to, output_geo.size.w)
    {
        special::arriving_windows(state, renderer, slide.to, offset, &spot, &mut elements);
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

/// The windows from the top down, each where it is, in flight, or in Mission
/// Control (`dragged` is the one drawn above the Desktops row instead).
fn window_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    view: &View<'_>,
    spot: &Spot,
    dragged: Option<crate::wm::WindowId>,
    screen_width: i32,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    // One window's picture, of a window on a Space that does not show: drawn where it waits.
    if let Some(only) = &view.only
        && state.space.element_location(only).is_none()
    {
        let waits = state
            .windows
            .by_window(only)
            .and_then(|e| crate::session::agent_away::away_content(state, e.id));
        if let Some((window, content)) = waits {
            framed_window(state, renderer, &window, content.loc, spot, elements);
        }
        return;
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
            .slide_offset(state.spaces.current, screen_width)
            .filter(|_| !held)
        {
            frame_at += offset;
        }
        let id = state.windows.by_window(window).map(|e| e.id);
        if let Some(flight) = id.and_then(|id| state.motion.flights.get(&id).copied()) {
            overview_window(state, renderer, window, flight.now().0, spot, elements);
            continue;
        }
        if state.overview.is_some() {
            if let Some(id) = id
                && dragged != Some(id)
                && let Some(rect) = state.overview_rect(id)
            {
                overview_window(state, renderer, window, rect, spot, elements);
            }
            continue;
        }
        framed_window(state, renderer, window, frame_at, spot, elements);
    }
}
