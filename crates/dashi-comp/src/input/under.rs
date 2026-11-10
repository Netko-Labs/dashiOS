//! Where the pointer is: the surface under a point, and a point kept on a screen.

use smithay::{
    desktop::{WindowSurfaceType, layer_map_for_output},
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point},
    wayland::shell::wlr_layer::Layer,
};

use crate::state::Dashi;

impl Dashi {
    /// The surface under `pos`, and where that surface's origin is: the
    /// overlay and top layers, then windows, then the bottom and background layers.
    pub(crate) fn surface_under(
        &self,
        pos: Point<f64, Logical>,
    ) -> Option<(WlSurface, Point<f64, Logical>)> {
        let window = || {
            self.space
                .element_under(pos)
                .and_then(|(window, location)| {
                    window
                        .surface_under(pos - location.to_f64(), WindowSurfaceType::ALL)
                        .map(|(surface, at)| (surface, (at + location).to_f64()))
                })
        };
        if self.lock.locked {
            let output = self.space.output_under(pos).next()?;
            let origin = self.space.output_geometry(output)?.loc;
            let lock = self.lock_surface_on(output)?;
            return smithay::desktop::utils::under_from_surface_tree(
                lock.wl_surface(),
                pos - origin.to_f64(),
                (0, 0),
                WindowSurfaceType::ALL,
            )
            .map(|(surface, at)| (surface, (at + origin).to_f64()));
        }
        let Some(output) = self.space.output_under(pos).next() else {
            return window();
        };
        let Some(origin) = self.space.output_geometry(output).map(|g| g.loc) else {
            return window();
        };
        // The layer map's lock is taken for each look and let go before anything
        // else that takes it (decoration_at does): a second lock would deadlock.
        // A surface the shell limited (IPC `input-region`) lets the pointer
        // through outside its rects, to whatever is under it (layer_regions.rs).
        let in_layer = |layer: Layer| {
            let layers = layer_map_for_output(output);
            let local = pos - origin.to_f64();
            layers
                .layers_on(layer)
                .rev()
                .find_map(|surface| self.layer_hit(&layers, surface, local))
                .map(|(surface, at)| (surface, at + origin.to_f64()))
        };
        let top_shown = self.shows_top_layers(output);
        if let Some(top) =
            in_layer(Layer::Overlay).or_else(|| top_shown.then(|| in_layer(Layer::Top)).flatten())
        {
            return Some(top);
        }
        // The overview's windows are the overview's, not their clients'.
        if self.overview.is_some() {
            return None;
        }
        // A title bar or the traffic lights: nothing a client gets.
        if self.decoration_at(pos).is_some() {
            return None;
        }
        window()
            .or_else(|| in_layer(Layer::Bottom))
            .or_else(|| in_layer(Layer::Background))
    }

    /// `at`, kept on a screen: the nearest point of the nearest screen when it leaves them.
    pub(crate) fn clamp_to_screens(&self, at: Point<f64, Logical>) -> Point<f64, Logical> {
        let screens: Vec<_> = self
            .space
            .outputs()
            .filter_map(|o| self.space.output_geometry(o))
            .collect();
        if screens.iter().any(|g| g.to_f64().contains(at)) || screens.is_empty() {
            return at;
        }
        screens
            .iter()
            .map(|g| {
                let g = g.to_f64();
                let x = at.x.clamp(g.loc.x, g.loc.x + g.size.w - 1.0);
                let y = at.y.clamp(g.loc.y, g.loc.y + g.size.h - 1.0);
                Point::from((x, y))
            })
            .min_by(|a, b| {
                let d = |p: &Point<f64, Logical>| (p.x - at.x).powi(2) + (p.y - at.y).powi(2);
                d(a).total_cmp(&d(b))
            })
            .unwrap_or(at)
    }
}
