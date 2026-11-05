//! The pictures' elements for one view of one screen, front to back: window
//! pictures, then Desktop pictures (each its windows from the top down, then
//! its wallpaper). Every piece is cut to its picture's rect.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            AsRenderElements, Element, Kind,
            memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
            surface::WaylandSurfaceRenderElement,
        },
    },
    desktop::Window,
    output::Output,
    utils::{Logical, Physical, Point, Rectangle, Scale, Size},
};

use super::{Thumb, fit, on_preview};
use crate::{
    render::{DashiElement, GlesAccess},
    state::Dashi,
    wm::Shown,
};

/// Window pictures are numbered after the Desktop pictures, which are never this many.
const WINDOW_SLOTS: usize = 1 << 12;

/// One window to draw small: where its outer frame goes, and its title bar.
struct Small {
    slot: usize,
    window: Window,
    outer: Rectangle<f64, Logical>,
    bar: f64,
    title: Option<MemoryRenderBuffer>,
    crop: Rectangle<i32, Logical>,
}

/// The pictures on `output` for a view of `area` at `scale`.
pub(crate) fn thumbnail_elements<R>(
    state: &mut Dashi,
    renderer: &mut R,
    output: &Output,
    area: Rectangle<i32, Logical>,
    scale: Scale<f64>,
) -> Vec<DashiElement<R>>
where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    if state.thumbnails.is_empty() {
        return Vec::new();
    }
    let Some(screen) = state.space.output_geometry(output) else {
        return Vec::new();
    };
    let origin = area.loc;
    let mut jobs: Vec<Small> = Vec::new();
    for (index, (id, rect)) in state.thumbnails.windows.iter().enumerate() {
        if rect.intersection(area).is_none() {
            continue;
        }
        let Some(entry) = state.windows.get(*id) else {
            continue;
        };
        let window = entry.window.clone();
        let bar = state.bar_height(&window);
        let size = window.geometry().size + Size::from((0, bar));
        jobs.push(Small {
            slot: WINDOW_SLOTS + index,
            outer: fit(size, *rect),
            bar: f64::from(bar),
            title: entry.title_image.as_ref().map(|image| image.buffer.clone()),
            window,
            crop: *rect,
        });
    }
    // Desktop pictures: after the window pictures, so behind them.
    let mut walls: Vec<(usize, Rectangle<i32, Logical>)> = Vec::new();
    let previews = state
        .thumbnails
        .previews
        .get(&output.name())
        .cloned()
        .unwrap_or_default();
    for (index, (space, rect)) in previews.into_iter().enumerate() {
        for (window, frame) in space_windows(state, space) {
            let bar = state.bar_height(&window);
            let outer = Rectangle::new(
                frame.loc - Point::from((0, bar)),
                frame.size + Size::from((0, bar)),
            );
            let title = state
                .windows
                .by_window(&window)
                .and_then(|entry| entry.title_image.as_ref())
                .map(|image| image.buffer.clone());
            jobs.push(Small {
                slot: index,
                outer: on_preview(screen, rect, outer),
                bar: f64::from(bar),
                title,
                window,
                crop: rect,
            });
        }
        walls.push((index, rect));
    }

    let mut elements = Vec::new();
    for job in &jobs {
        small_window(state, renderer, job, origin, scale, &mut elements);
    }
    // Wallpapers last: each behind its picture's windows (pictures don't overlap one another).
    for (slot, rect) in walls {
        let at = rect.loc - origin;
        let Some(wallpaper) = state.wallpaper.element(renderer, at, rect.size, scale) else {
            continue;
        };
        let crop = physical(rect, origin, scale);
        let id = state.thumbnails.id(slot, wallpaper.id());
        if let Some(thumb) = Thumb::new(wallpaper, crop.loc, 1.0, scale, crop, id) {
            elements.push(DashiElement::ThumbMemory(thumb));
        }
    }
    elements
}

/// Space `space`'s windows that show, top first, with where each is (its content's frame).
fn space_windows(state: &Dashi, space: usize) -> Vec<(Window, Rectangle<i32, Logical>)> {
    if space == state.spaces.current {
        return state
            .space
            .elements()
            .rev()
            .filter_map(|window| Some((window.clone(), state.space.element_geometry(window)?)))
            .collect();
    }
    // Off screen they wait in the registry's order, the last on top when they come back.
    let mut waiting: Vec<_> = state
        .windows
        .entries()
        .filter(|e| e.space == space && e.shown == Shown::Normal && e.placed)
        .filter_map(|e| {
            let at = e.away_at?;
            Some((
                e.window.clone(),
                Rectangle::new(at, e.window.geometry().size),
            ))
        })
        .collect();
    waiting.reverse();
    waiting
}

fn physical(
    rect: Rectangle<i32, Logical>,
    origin: Point<i32, Logical>,
    scale: Scale<f64>,
) -> Rectangle<i32, Physical> {
    Rectangle::new(
        (rect.loc - origin).to_physical_precise_round(scale),
        rect.size.to_physical_precise_round(scale),
    )
}

/// A window drawn small at `job.outer` (its outer frame), cut to its picture.
fn small_window<R>(
    state: &mut Dashi,
    renderer: &mut R,
    job: &Small,
    origin: Point<i32, Logical>,
    scale: Scale<f64>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let geometry = job.window.geometry();
    let by = job.outer.size.w / f64::from(geometry.size.w.max(1));
    let crop = physical(job.crop, origin, scale);
    let inner = job.outer.loc + Point::from((0.0, job.bar * by));
    // Drawn at full size at its small spot, then shrunk about that spot (popups and subsurfaces too).
    let surface_at = (inner - geometry.loc.to_f64() - origin.to_f64())
        .to_physical(scale)
        .to_i32_round();
    let about = (inner - origin.to_f64()).to_physical(scale).to_i32_round();
    let surfaces = job
        .window
        .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0);
    for element in surfaces {
        let id = state.thumbnails.id(job.slot, element.id());
        if let Some(thumb) = Thumb::new(element, about, by, scale, crop, id) {
            elements.push(DashiElement::ThumbSurface(thumb));
        }
    }
    let Some(title) = job.title.as_ref().filter(|_| job.bar > 0.0) else {
        return;
    };
    let at = (job.outer.loc - origin.to_f64()).to_physical(scale);
    let size = Size::from((
        job.outer.size.w.round() as i32,
        (job.bar * by).round().max(1.0) as i32,
    ));
    match MemoryRenderBufferRenderElement::from_buffer(
        renderer,
        at,
        title,
        None,
        None,
        Some(size),
        Kind::Unspecified,
    ) {
        Ok(bar) => {
            let id = state.thumbnails.id(job.slot, bar.id());
            if let Some(thumb) = Thumb::new(bar, crop.loc, 1.0, scale, crop, id) {
                elements.push(DashiElement::ThumbMemory(thumb));
            }
        }
        Err(error) => tracing::debug!(?error, "drawing a small title bar"),
    }
}
