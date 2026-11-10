//! Where the shell's layer surfaces take the pointer (IPC `input-region`).
//! A Metal host's surface is a rectangle, and a floating one (the Dock: a
//! full-width strip with the panel in its middle) is mostly transparent; Metal
//! can't set a wl_surface input region, so the shell names the parts that
//! take clicks and the rest passes through to the windows under it. Popups
//! of such a surface are not limited. Only the shell's own namespaces
//! (`dashi.*`) can be limited.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use smithay::{
    desktop::{LayerMap, LayerSurface, WindowSurfaceType},
    utils::{Logical, Point, Rectangle},
    wayland::shell::wlr_layer::Layer,
};

use crate::{ipc::protocol::Finite, state::Dashi};

/// More rectangles than any surface of the shell's needs.
const MOST: usize = 32;

/// `input-region`'s params: a shell layer namespace and the rects (surface
/// coordinates) where it takes the pointer, or null for the whole surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InputRegion {
    pub namespace: String,
    pub rects: Option<Vec<RegionRect>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RegionRect {
    pub x: Finite,
    pub y: Finite,
    pub width: Finite,
    pub height: Finite,
}

/// The limited surfaces, by layer-shell namespace: rectangles in surface coordinates.
#[derive(Default)]
pub(crate) struct LayerRegions(HashMap<String, Vec<Rectangle<f64, Logical>>>);

impl LayerRegions {
    /// Whether a surface of `namespace` takes the pointer at `at` (surface coordinates).
    pub(crate) fn allows(&self, namespace: &str, at: Point<f64, Logical>) -> bool {
        self.0
            .get(namespace)
            .is_none_or(|rects| rects.iter().any(|rect| rect.contains(at)))
    }
}

impl Dashi {
    /// The topmost surface on `layer` that takes the pointer at `local`
    /// (output coordinates): the client's own input region, then the
    /// shell's limit (popups pass it).
    pub(crate) fn layer_at(
        &self,
        map: &LayerMap,
        layer: Layer,
        local: Point<f64, Logical>,
    ) -> Option<LayerSurface> {
        map.layers_on(layer)
            .rev()
            .find(|surface| self.layer_hit(map, surface, local).is_some())
            .cloned()
    }

    /// Where on `surface` the pointer at `local` lands, if it does: the
    /// surface hit and its origin in output coordinates.
    pub(crate) fn layer_hit(
        &self,
        map: &LayerMap,
        surface: &LayerSurface,
        local: Point<f64, Logical>,
    ) -> Option<(
        smithay::reexports::wayland_server::protocol::wl_surface::WlSurface,
        Point<f64, Logical>,
    )> {
        let at = map.layer_geometry(surface)?.loc;
        let inner = local - at.to_f64();
        let kinds = if self.layer_regions.allows(surface.namespace(), inner) {
            WindowSurfaceType::ALL
        } else {
            WindowSurfaceType::POPUP
        };
        surface
            .surface_under(inner, kinds)
            .map(|(hit, loc)| (hit, (loc + at).to_f64()))
    }

    /// IPC `input-region {namespace, rects}`: `rects` null is the whole surface again.
    pub(crate) fn set_layer_region(&mut self, params: &InputRegion) -> Result<(), String> {
        let namespace = params.namespace.as_str();
        if !namespace.starts_with("dashi.") || namespace.len() > 64 {
            return Err("input-region: `namespace` must be one of the shell's (dashi.*)".into());
        }
        let Some(rects) = &params.rects else {
            self.layer_regions.0.remove(namespace);
            return Ok(());
        };
        if rects.len() > MOST {
            return Err(format!(
                "input-region: `rects` must be a list of at most {MOST}, or null"
            ));
        }
        let parsed = rects
            .iter()
            .map(|rect| {
                Rectangle::new(
                    (rect.x.get(), rect.y.get()).into(),
                    (rect.width.get().max(0.0), rect.height.get().max(0.0)).into(),
                )
            })
            .collect();
        self.layer_regions.0.insert(namespace.to_owned(), parsed);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_limited_surface_takes_the_pointer_only_in_its_rects() {
        let mut regions = LayerRegions::default();
        assert!(regions.allows("dashi.dock", (5.0, 5.0).into()));
        regions.0.insert(
            "dashi.dock".into(),
            vec![Rectangle::new((100.0, 10.0).into(), (200.0, 60.0).into())],
        );
        assert!(regions.allows("dashi.dock", (150.0, 40.0).into()));
        assert!(!regions.allows("dashi.dock", (50.0, 40.0).into()));
        assert!(regions.allows("dashi.menubar", (50.0, 40.0).into()));
    }
}
