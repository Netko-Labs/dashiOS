//! The pieces of a screen that are not an ordinary window or layer: the lock
//! screen, where a dragged window would tile, windows flying to the Dock, and
//! the Space sliding in from beside.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            Kind,
            solid::SolidColorRenderElement,
            surface::{WaylandSurfaceRenderElement, render_elements_from_surface_tree},
        },
    },
    output::Output,
    utils::{Logical, Point, Scale},
};

use crate::{
    render::{
        DashiElement,
        rounded::GlesAccess,
        windows::{Spot, framed_window, overview_window},
    },
    state::Dashi,
};

/// The lock screen over the wallpaper, and nothing of the session.
pub(super) fn locked_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output: &Output,
    layer_offset: Point<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let Some(output_geo) = state.space.output_geometry(output) else {
        return;
    };
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
    if let Some(wallpaper) = state
        .wallpaper
        .element(renderer, layer_offset, output_geo.size, scale)
    {
        elements.push(DashiElement::Memory(wallpaper));
    }
}

/// Where a dragged window would tile, over the windows.
pub(super) fn tile_preview<R>(
    state: &Dashi,
    origin: Point<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
{
    let Some(preview) = state.zones.preview else {
        return;
    };
    let area = smithay::utils::Rectangle::new(
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

/// Windows flying into the Dock: no longer on screen, still drawn.
pub(super) fn flying_ghosts<R>(
    state: &mut Dashi,
    renderer: &mut R,
    spot: &Spot,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
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
        overview_window(state, renderer, &window, flight.now().0, spot, elements);
    }
}

/// The windows of Space `to`, sliding in from beside by `offset`, from where they wait.
pub(super) fn arriving_windows<R>(
    state: &mut Dashi,
    renderer: &mut R,
    to: usize,
    offset: Point<i32, Logical>,
    spot: &Spot,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let arriving: Vec<_> = state
        .windows
        .waiting_on(to)
        .into_iter()
        .filter_map(|e| e.away_at.map(|at| (e.window.clone(), at)))
        .collect();
    for (window, at) in arriving.into_iter().rev() {
        // Drawn as in its frame (its title bar or lights, its corners, its depth), where it waits.
        framed_window(state, renderer, &window, at + offset, spot, elements);
    }
}
