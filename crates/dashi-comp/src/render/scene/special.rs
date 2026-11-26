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
        // Its panes of glass, behind it and over the wallpaper: the lock's veil and Today (LK-4).
        elements.extend(
            state
                .glass
                .surface_elements(lock.wl_surface(), (at, output_geo.size), scale, None, None)
                .into_iter()
                .map(DashiElement::Glass),
        );
    }
    if let Some(wallpaper) = state
        .wallpaper
        .element(renderer, layer_offset, output_geo.size, scale)
    {
        elements.push(DashiElement::Memory(wallpaper));
    }
}

/// The wash an older shell's preview gets, which names no look: white at a quarter, premultiplied.
const PLAIN_PREVIEW: [f32; 4] = [0.25, 0.25, 0.25, 0.25];

/// Where a dragged window would tile, over the windows: a pane of glass as the shell says
/// (WI-10: thin, radius 10, inset 6), or a plain wash where glass can't be drawn.
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
    let mut area = smithay::utils::Rectangle::new(
        (preview.loc - origin).to_physical_precise_round(scale),
        preview.size.to_physical_precise_round(scale),
    );
    if let Some(look) = state.zones.look {
        let inset = (look.inset.get() * scale.x).round() as i32;
        area = smithay::utils::Rectangle::new(
            area.loc + Point::from((inset, inset)),
            (
                (area.size.w - 2 * inset).max(1),
                (area.size.h - 2 * inset).max(1),
            )
                .into(),
        );
        if let Some(pane) = state
            .glass
            .preview_element(area, look.level, look.radius.get(), scale)
        {
            elements.push(DashiElement::Glass(pane));
            return;
        }
    }
    let shade = smithay::backend::renderer::element::solid::SolidColorBuffer::new(
        area.size.to_logical(1),
        PLAIN_PREVIEW,
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
