//! Cutting a window's corners round: where the cut reaches and the shader that does it.

use smithay::{
    backend::renderer::{
        ImportAll, Renderer,
        element::{Element, surface::WaylandSurfaceRenderElement},
    },
    desktop::Window,
    utils::{Physical, Point, Rectangle, Scale},
};

use crate::{
    render::{rounded::GlesAccess, titlebar::Decor},
    state::Dashi,
};

/// How a window's corners are cut: the shader, the window's box, and which corners.
pub(super) struct Rounding {
    program: smithay::backend::renderer::gles::GlesTexProgram,
    /// In the pixels it is drawn at (shrunk with it in the overview).
    radius: f32,
    top: bool,
    /// The window's geometry, in the physical pixels its surfaces' elements are made at.
    window: Rectangle<i32, Physical>,
    /// The scale they are made at, and the radius there.
    scale: Scale<f64>,
    reach: i32,
}

impl Rounding {
    /// Whether `element` reaches one of the cut corners (a surface away from them is drawn as it is).
    pub(super) fn reaches<R: Renderer + ImportAll>(
        &self,
        element: &WaylandSurfaceRenderElement<R>,
    ) -> bool {
        let at = element.geometry(self.scale);
        let (w, r) = (self.window, self.reach);
        let (left, right) = (w.loc.x, w.loc.x + w.size.w - r);
        let (upper, lower) = (w.loc.y, w.loc.y + w.size.h - r);
        let mut corners = vec![(left, lower), (right, lower)];
        if self.top {
            corners.extend([(left, upper), (right, upper)]);
        }
        corners
            .into_iter()
            .any(|(x, y)| at.overlaps(Rectangle::new((x, y).into(), (r, r).into())))
    }

    pub(super) fn element<R: Renderer + ImportAll>(
        &self,
        element: WaylandSurfaceRenderElement<R>,
    ) -> crate::render::rounded::RoundedElement<R> {
        let at = element.geometry(self.scale);
        let (w, h) = (at.size.w.max(1) as f32, at.size.h.max(1) as f32);
        let window = [
            (self.window.loc.x - at.loc.x) as f32 / w,
            (self.window.loc.y - at.loc.y) as f32 / h,
            self.window.size.w as f32 / w,
            self.window.size.h as f32 / h,
        ];
        crate::render::rounded::RoundedElement::new(
            element,
            self.program.clone(),
            self.radius,
            self.top,
            window,
        )
    }
}

/// The rounding for a window Dashi frames, and for one that draws its own frame while it is
/// maximized (the shell's Fill: its own corners and shadow go then, and a maximized window is
/// rounded as Dashi's are); none full screen, or with square corners chosen. Under Dashi's
/// title bar only the bottom corners (the bar rounds the top), otherwise all four.
/// `at`: the window's geometry where its surfaces' elements are made, at `scale`; `small`: how
/// much they are shrunk after (the overview), 1 otherwise.
pub(super) fn rounding<R>(
    state: &Dashi,
    renderer: &mut R,
    window: &Window,
    at: Point<i32, Physical>,
    scale: Scale<f64>,
    small: f64,
) -> Option<Rounding>
where
    R: Renderer + GlesAccess,
{
    let entry = state.windows.by_window(window)?;
    let framed = matches!(entry.decor, Decor::Standard | Decor::Unified);
    // Full screen, it is square to the screen's edges.
    if !(framed || entry.maximized) || entry.fullscreen.is_some() || state.chrome_style.radius <= 0
    {
        return None;
    }
    let top = entry.decor != Decor::Standard;
    let program = crate::render::rounded::program(renderer.gles())?;
    let reach = f64::from(state.chrome_style.radius) * scale.x;
    Some(Rounding {
        program,
        radius: (reach * small) as f32,
        top,
        window: Rectangle::new(at, window.geometry().size.to_physical_precise_round(scale)),
        scale,
        reach: reach.ceil() as i32,
    })
}
