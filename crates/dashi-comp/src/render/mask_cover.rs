//! Two of `capture-mask`'s measures (mask.rs): a window's popups, as drawn
//! now (a browser's "save this card?" prompt is an xdg_popup with
//! subsurfaces), and the opaque areas of the windows in front of a window,
//! so a field's blank stops where another window covers it.

use smithay::{
    backend::renderer::utils::RendererSurfaceStateUserData,
    desktop::{PopupManager, utils::bbox_from_surface_tree},
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point, Rectangle},
    wayland::{compositor::with_states, seat::WaylandFocus},
};

use super::mask::outward;
use crate::state::Dashi;

impl Dashi {
    /// Window `id`'s popups (each with its subsurfaces), global, where they are drawn now.
    pub(crate) fn popup_rects(&self, id: u64) -> Vec<(WlSurface, Rectangle<i32, Logical>)> {
        let Some((window, outer, by)) = self.drawn(id) else {
            return Vec::new();
        };
        let Some(surface) = window.wl_surface() else {
            return Vec::new();
        };
        let bar = f64::from(self.bar_height(&window)) * by;
        let content = outer.loc + Point::from((0.0, bar));
        PopupManager::popups_for_surface(&surface)
            .map(|(popup, location)| {
                // From the window's geometry origin, as bbox_with_popups places it.
                let bbox =
                    bbox_from_surface_tree(popup.wl_surface(), location - popup.geometry().loc);
                let at = content + bbox.loc.to_f64().upscale(by);
                let rect = outward(Rectangle::new(at, bbox.size.to_f64().upscale(by)));
                (popup.wl_surface().clone(), rect)
            })
            .collect()
    }

    /// What covers window `id` for certain: the opaque regions the windows in
    /// front of it declare, less their corners (Dashi rounds them). None while
    /// anything moves (the overview, a slide, a flight): then nothing is clipped.
    pub(crate) fn covered(&self, id: u64) -> Vec<Rectangle<i32, Logical>> {
        if self.overview.is_some() || self.spaces.slide.is_some() || !self.motion.flights.is_empty()
        {
            return Vec::new();
        }
        let Some(target) = self.windows.get(id).map(|entry| entry.window.clone()) else {
            return Vec::new();
        };
        let corner = self.chrome_style.radius.max(0) + 1;
        let mut out = Vec::new();
        // Back to front: what comes after the window is in front of it.
        for window in self.space.elements().skip_while(|w| **w != target).skip(1) {
            let Some(front) = self.windows.by_window(window).map(|entry| entry.id) else {
                continue;
            };
            let Some((outer, by)) = self.drawn_frame(front) else {
                continue;
            };
            let Some(surface) = window.wl_surface() else {
                continue;
            };
            if by != 1.0 {
                continue;
            }
            let outer = outward(outer);
            let content = outer.loc + Point::from((0, self.bar_height(window)));
            let geometry = window.geometry();
            let shown = Rectangle::new(content, geometry.size);
            let origin = content - geometry.loc;
            let corners = [
                (outer.loc.x, outer.loc.y),
                (outer.loc.x + outer.size.w - corner, outer.loc.y),
                (outer.loc.x, outer.loc.y + outer.size.h - corner),
                (
                    outer.loc.x + outer.size.w - corner,
                    outer.loc.y + outer.size.h - corner,
                ),
            ]
            .map(|at| Rectangle::new(at.into(), (corner, corner).into()));
            let opaque = opaque_regions(&surface)
                .into_iter()
                .filter_map(|r| Rectangle::new(r.loc + origin, r.size).intersection(shown));
            out.extend(Rectangle::subtract_rects_many(opaque, corners));
        }
        out
    }
}

/// The opaque region a surface declared, in its own coordinates (none if it declared none).
fn opaque_regions(surface: &WlSurface) -> Vec<Rectangle<i32, Logical>> {
    with_states(surface, |states| {
        states
            .data_map
            .get::<RendererSurfaceStateUserData>()
            .and_then(|data| {
                data.lock()
                    .ok()
                    .and_then(|data| data.opaque_regions().map(<[_]>::to_vec))
            })
            .unwrap_or_default()
    })
}
