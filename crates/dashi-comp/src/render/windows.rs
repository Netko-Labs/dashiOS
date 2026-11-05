//! One window's elements, front to back: its popups, the edge (depth/), its
//! title bar or lights and its surfaces (the main one with rounded corners),
//! then its shadow and ring. Drawn in its frame, small (the overview, a
//! flight to the Dock), or sliding in with its Space.

use smithay::{
    backend::renderer::{
        ImportAll, ImportMem, Renderer,
        element::{
            AsRenderElements, Element, Id, Kind,
            memory::{MemoryRenderBuffer, MemoryRenderBufferRenderElement},
            surface::{WaylandSurfaceRenderElement, render_elements_from_surface_tree},
            utils::RescaleRenderElement,
        },
    },
    desktop::{PopupManager, Window},
    utils::{Logical, Physical, Point, Rectangle, Scale, Size},
    wayland::seat::WaylandFocus,
};

use super::{
    DashiElement,
    depth::{self, Placement},
    rounded::GlesAccess,
    titlebar::Decor,
};
use crate::state::Dashi;

/// Where and how a window is drawn on a view.
pub(crate) struct Spot {
    /// The view's top-left, global logical, and its scale.
    pub origin: Point<i32, Logical>,
    pub scale: Scale<f64>,
    /// The view's area, global logical (where a shadow may show).
    pub area: Rectangle<i32, Logical>,
    /// With its shadow and edge (not in a capture of the window alone).
    pub depth: bool,
}

/// A window's surfaces as two lists, front to back: its popups, then its own tree.
fn surface_layers<R>(
    renderer: &mut R,
    window: &Window,
    at: Point<i32, Physical>,
    scale: Scale<f64>,
) -> (
    Vec<WaylandSurfaceRenderElement<R>>,
    Vec<WaylandSurfaceRenderElement<R>>,
)
where
    R: Renderer + ImportAll,
    R::TextureId: Clone + 'static,
{
    let Some(toplevel) = window.toplevel() else {
        return (Vec::new(), window.render_elements(renderer, at, scale, 1.0));
    };
    let surface = toplevel.wl_surface();
    let mut popups = Vec::new();
    for (popup, offset) in PopupManager::popups_for_surface(surface) {
        let offset = (window.geometry().loc + offset - popup.geometry().loc)
            .to_physical_precise_round(scale);
        popups.extend(render_elements_from_surface_tree::<
            _,
            WaylandSurfaceRenderElement<R>,
        >(
            renderer,
            popup.wl_surface(),
            at + offset,
            scale,
            1.0,
            Kind::Unspecified,
        ));
    }
    let tree = render_elements_from_surface_tree::<_, WaylandSurfaceRenderElement<R>>(
        renderer,
        surface,
        at,
        scale,
        1.0,
        Kind::Unspecified,
    );
    (popups, tree)
}

fn depth_of<R>(
    state: &mut Dashi,
    renderer: &mut R,
    window: &Window,
    placed: Placement,
    spot: &Spot,
) -> depth::Sides
where
    R: Renderer + GlesAccess,
{
    match state.windows.by_window(window).map(|entry| entry.id) {
        Some(id) if spot.depth => {
            depth::window_depth(state, renderer.gles(), id, &placed, spot.area, spot.scale)
        }
        _ => depth::Sides::default(),
    }
}

/// A window in its frame: `at` is where its geometry's top-left is (global logical).
pub(crate) fn framed_window<R>(
    state: &mut Dashi,
    renderer: &mut R,
    window: &Window,
    at: Point<i32, Logical>,
    spot: &Spot,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let scale = spot.scale;
    let bar = state.bar_height(window);
    let size = window.geometry().size;
    let outer = Rectangle::new(
        Point::from((at.x, at.y - bar)),
        Size::from((size.w, size.h + bar)),
    );
    let placed = Placement {
        frame: outer.to_f64(),
        small: 1.0,
        ring: true,
    };
    let sides = depth_of(state, renderer, window, placed, spot);
    let entry = state.windows.by_window(window);
    let decor = entry.map(|entry| entry.decor).unwrap_or(Decor::None);
    let image = entry.and_then(|entry| entry.title_image.as_ref());
    let on_view = |at: Point<i32, Logical>| -> Point<i32, Physical> {
        (at - spot.origin).to_physical_precise_round(scale)
    };
    let surface_at = on_view(at - window.geometry().loc);
    let (popups, tree) = surface_layers(renderer, window, surface_at, scale);
    elements.extend(popups.into_iter().map(DashiElement::Surface));
    elements.extend(sides.front.map(DashiElement::Depth));
    if let (Decor::Unified, Some(image)) = (decor, image) {
        push_memory(
            renderer,
            on_view(at).to_f64(),
            &image.buffer,
            None,
            elements,
        );
    }
    // Dashi's frame rounds the corners: the bottom ones under its bar, all four on a unified window.
    let rounding = rounding(state, renderer, window, decor == Decor::Unified, scale.x);
    elements.extend(tree.into_iter().map(|element| match &rounding {
        Some(rounding) if element.id() == &rounding.root => {
            DashiElement::Rounded(rounding.element(element))
        }
        _ => DashiElement::Surface(element),
    }));
    if let (Decor::Standard, Some(image)) = (decor, image) {
        push_memory(
            renderer,
            on_view(outer.loc).to_f64(),
            &image.buffer,
            None,
            elements,
        );
    }
    elements.extend(sides.back.map(DashiElement::Depth));
}

/// A window of a Space sliding in, drawn from where it waits (`at`: its geometry's top-left).
pub(crate) fn arriving_window<R>(
    state: &mut Dashi,
    renderer: &mut R,
    window: &Window,
    at: Point<i32, Logical>,
    spot: &Spot,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let placed = Placement {
        frame: Rectangle::new(at, window.geometry().size).to_f64(),
        small: 1.0,
        ring: true,
    };
    let sides = depth_of(state, renderer, window, placed, spot);
    let surface_at =
        (at - window.geometry().loc - spot.origin).to_physical_precise_round(spot.scale);
    // Drawn without its title bar: all four corners round, as its edge does.
    let rounding = rounding(state, renderer, window, true, spot.scale.x);
    elements.extend(sides.front.map(DashiElement::Depth));
    elements.extend(
        window
            .render_elements::<WaylandSurfaceRenderElement<R>>(
                renderer, surface_at, spot.scale, 1.0,
            )
            .into_iter()
            .map(|element| match &rounding {
                Some(rounding) if element.id() == &rounding.root => {
                    DashiElement::Rounded(rounding.element(element))
                }
                _ => DashiElement::Surface(element),
            }),
    );
    elements.extend(sides.back.map(DashiElement::Depth));
}

/// A window drawn small where the overview puts it (`rect`: its outer frame there).
pub(crate) fn overview_window<R>(
    state: &mut Dashi,
    renderer: &mut R,
    window: &Window,
    rect: Rectangle<f64, Logical>,
    spot: &Spot,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    let (origin, scale) = (spot.origin.to_f64(), spot.scale);
    let geometry = window.geometry();
    let bar = f64::from(state.bar_height(window));
    let outer_w = f64::from(geometry.size.w.max(1));
    let s = rect.size.w / outer_w;
    let placed = Placement {
        frame: rect,
        small: s,
        ring: false,
    };
    let sides = depth_of(state, renderer, window, placed, spot);
    elements.extend(sides.front.map(DashiElement::Depth));
    let inner = rect.loc + Point::from((0.0, bar * s));
    // Drawn at full size at its small spot, then shrunk about that spot (popups and subsurfaces too).
    let surface_at = (inner - geometry.loc.to_f64() - origin)
        .to_physical(scale)
        .to_i32_round();
    let about = (inner - origin).to_physical(scale).to_i32_round();
    // Rounded as in its frame, at its small size (the corners its edge and shadow follow).
    let unified = state
        .windows
        .by_window(window)
        .is_some_and(|entry| entry.decor == Decor::Unified);
    let rounding = rounding(state, renderer, window, unified, scale.x * s);
    elements.extend(
        window
            .render_elements::<WaylandSurfaceRenderElement<R>>(renderer, surface_at, scale, 1.0)
            .into_iter()
            .map(|element| match &rounding {
                Some(rounding) if element.id() == &rounding.root => DashiElement::ScaledRounded(
                    RescaleRenderElement::from_element(rounding.element(element), about, s),
                ),
                _ => DashiElement::Scaled(RescaleRenderElement::from_element(element, about, s)),
            }),
    );
    let image = state
        .windows
        .by_window(window)
        .and_then(|entry| entry.title_image.as_ref());
    if let Some(image) = image.filter(|_| bar > 0.0) {
        let at = (rect.loc - origin).to_physical(scale);
        // The whole bar, shrunk to fit (not its top-left cut out at the small size).
        let own = Size::from((outer_w, bar));
        let size = Size::from((
            rect.size.w.round() as i32,
            (bar * s).round().max(1.0) as i32,
        ));
        push_memory(renderer, at, &image.buffer, Some((own, size)), elements);
    }
    elements.extend(sides.back.map(DashiElement::Depth));
}

/// How a framed window's main surface is rounded: which surface, the shader, and the corners.
struct Rounding {
    root: Id,
    program: smithay::backend::renderer::gles::GlesTexProgram,
    /// In the pixels it is drawn at.
    radius: f32,
    top: bool,
}

impl Rounding {
    fn element<R: Renderer>(
        &self,
        element: WaylandSurfaceRenderElement<R>,
    ) -> super::rounded::RoundedElement<R> {
        super::rounded::RoundedElement::new(element, self.program.clone(), self.radius, self.top)
    }
}

/// The rounding for a window Dashi frames (none for others, full screen, or with square corners chosen);
/// `pixels`: physical pixels per logical one where it is drawn (its scale, times how small).
fn rounding<R>(
    state: &Dashi,
    renderer: &mut R,
    window: &Window,
    top: bool,
    pixels: f64,
) -> Option<Rounding>
where
    R: Renderer + GlesAccess,
{
    let entry = state.windows.by_window(window)?;
    let framed = matches!(entry.decor, Decor::Standard | Decor::Unified);
    // Full screen, it is square to the screen's edges.
    if !framed || entry.fullscreen.is_some() || state.chrome_style.radius <= 0 {
        return None;
    }
    let program = super::rounded::program(renderer.gles())?;
    let root = window
        .wl_surface()
        .map(|surface| Id::from_wayland_resource(&*surface))?;
    Some(Rounding {
        root,
        program,
        radius: (f64::from(state.chrome_style.radius) * pixels) as f32,
        top,
    })
}

pub(crate) fn push_memory<R>(
    renderer: &mut R,
    at: Point<f64, Physical>,
    buffer: &MemoryRenderBuffer,
    // Drawn at another size: (its own, the one to draw it at).
    fit: Option<(Size<f64, Logical>, Size<i32, Logical>)>,
    elements: &mut Vec<DashiElement<R>>,
) where
    R: Renderer + ImportAll + ImportMem + GlesAccess,
    R::TextureId: Clone + Send + 'static,
{
    match MemoryRenderBufferRenderElement::from_buffer(
        renderer,
        at,
        buffer,
        None,
        fit.map(|(own, _)| Rectangle::from_size(own)),
        fit.map(|(_, size)| size),
        Kind::Unspecified,
    ) {
        Ok(element) => elements.push(DashiElement::Memory(element)),
        Err(error) => tracing::warn!(?error, "drawing the compositor's own image"),
    }
}
