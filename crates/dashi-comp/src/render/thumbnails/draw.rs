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
    render::{DashiElement, GlesAccess, titlebar::Decor},
    state::Dashi,
};

/// Window pictures are numbered after the Desktop pictures, which are never this many.
const WINDOW_SLOTS: usize = 1 << 12;

/// One window to draw small: where its outer frame goes, and its title bar
/// or (a unified window's) lights, which shrink with it at the same spot.
struct Small {
    slot: usize,
    window: Window,
    outer: Rectangle<f64, Logical>,
    bar: f64,
    title: Option<Title>,
    crop: Rectangle<i32, Logical>,
}

/// A window's title bar or lights image, its size at full size, and whether it is lights.
struct Title {
    buffer: MemoryRenderBuffer,
    size: Size<i32, Logical>,
    lights: bool,
}

/// The title image `window` shows now, with a bar `bar` high.
fn title_of(state: &Dashi, window: &Window, bar: i32) -> Option<Title> {
    let image = state
        .windows
        .by_window(window)?
        .title_images
        .get(state.decor_scale)
        .filter(|image| image.shows(f64::from(bar)))?;
    Some(Title {
        buffer: image.buffer.clone(),
        size: image.size(),
        lights: image.look.decor == Decor::Unified,
    })
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
            title: title_of(state, &window, bar),
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
    for (index, preview) in previews.into_iter().enumerate() {
        let rect = preview.rect;
        // The screen it pictures: this one, or another one shown here (the share picker's).
        let pictured = state
            .space
            .outputs()
            .find(|o| o.name() == preview.screen)
            .and_then(|o| state.space.output_geometry(o))
            .unwrap_or(screen);
        for (window, frame) in space_windows(state, preview.space) {
            if frame.intersection(pictured).is_none() {
                continue;
            }
            let bar = state.bar_height(&window);
            let outer = Rectangle::new(
                frame.loc - Point::from((0, bar)),
                frame.size + Size::from((0, bar)),
            );
            let title = title_of(state, &window, bar);
            jobs.push(Small {
                slot: index,
                outer: on_preview(pictured, rect, outer),
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
    // Off screen they wait in the order they had (wm/windows.rs `away_rank`).
    let mut waiting: Vec<_> = state
        .windows
        .waiting_on(space)
        .into_iter()
        .filter(|e| e.placed)
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
    // A unified window's lights are over its surfaces; a title bar is above them.
    let lights = job.title.as_ref().is_some_and(|title| title.lights);
    if lights {
        small_title(state, renderer, job, origin, scale, crop, elements);
    }
    let surfaces = job
        .window
        .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0);
    for element in surfaces {
        let id = state.thumbnails.id(job.slot, element.id());
        if let Some(thumb) = Thumb::new(element, about, by, scale, crop, id) {
            elements.push(DashiElement::ThumbSurface(thumb));
        }
    }
    if !lights {
        small_title(state, renderer, job, origin, scale, crop, elements);
    }
}

/// `job`'s title bar or lights: the whole image, shrunk with the window, at its top-left.
fn small_title<R>(
    state: &mut Dashi,
    renderer: &mut R,
    job: &Small,
    origin: Point<i32, Logical>,
    scale: Scale<f64>,
    crop: Rectangle<i32, Physical>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let Some(title) = job.title.as_ref() else {
        return;
    };
    let by = job.outer.size.w / f64::from(job.window.geometry().size.w.max(1));
    let at = (job.outer.loc - origin.to_f64()).to_physical(scale);
    let own = title.size.to_f64();
    let size = Size::from((
        (own.w * by).round().max(1.0) as i32,
        (own.h * by).round().max(1.0) as i32,
    ));
    match MemoryRenderBufferRenderElement::from_buffer(
        renderer,
        at,
        &title.buffer,
        None,
        None,
        Some(size),
        Kind::Unspecified,
    ) {
        Ok(image) => {
            let id = state.thumbnails.id(job.slot, image.id());
            if let Some(thumb) = Thumb::new(image, crop.loc, 1.0, scale, crop, id) {
                elements.push(DashiElement::ThumbMemory(thumb));
            }
        }
        Err(error) => tracing::debug!(?error, "drawing a small title bar"),
    }
}
