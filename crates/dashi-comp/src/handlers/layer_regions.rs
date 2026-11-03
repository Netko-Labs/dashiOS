//! Where the shell's layer surfaces take the pointer (IPC `input-region`).
//! A Metal host's surface is a rectangle, and a floating one (the Dock: a
//! full-width strip with the panel in its middle) is mostly transparent; Metal
//! can't set a wl_surface input region, so the shell names the parts that
//! take clicks and the rest passes through to the windows under it. Popups
//! of such a surface are not limited. Only the shell's own namespaces
//! (`dashi.*`) can be limited.

use std::collections::HashMap;

use serde_json::{Map, Value};
use smithay::{
    desktop::{LayerMap, LayerSurface, WindowSurfaceType},
    utils::{Logical, Point, Rectangle},
    wayland::shell::wlr_layer::Layer,
};

use crate::state::Dashi;

/// More rectangles than any surface of the shell's needs.
const MOST: usize = 32;

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
    pub(crate) fn set_layer_region(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let namespace = params
            .get("namespace")
            .and_then(Value::as_str)
            .filter(|name| name.starts_with("dashi.") && name.len() <= 64)
            .ok_or("input-region: `namespace` must be one of the shell's (dashi.*)")?;
        let rects = match params.get("rects") {
            None | Some(Value::Null) => {
                self.layer_regions.0.remove(namespace);
                return Ok(());
            }
            Some(Value::Array(rects)) if rects.len() <= MOST => rects,
            Some(_) => {
                return Err(format!(
                    "input-region: `rects` must be a list of at most {MOST}, or null"
                ));
            }
        };
        let parsed = rects
            .iter()
            .map(|rect| {
                let get = |key: &str| {
                    rect.get(key)
                        .and_then(Value::as_f64)
                        .filter(|v| v.is_finite())
                };
                Some(Rectangle::new(
                    (get("x")?, get("y")?).into(),
                    (get("width")?.max(0.0), get("height")?.max(0.0)).into(),
                ))
            })
            .collect::<Option<Vec<_>>>()
            .ok_or("input-region: each rect needs x, y, width, and height")?;
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
