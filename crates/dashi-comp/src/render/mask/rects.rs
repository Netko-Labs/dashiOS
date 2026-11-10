//! The global areas a mask covers now, wherever what it names is drawn.

use smithay::{
    desktop::layer_map_for_output,
    utils::{Logical, Point, Rectangle},
};

use super::{Mask, blank::outward};
use crate::state::Dashi;

impl Dashi {
    /// The global areas `mask` covers now, wherever what it names is drawn.
    pub(crate) fn mask_rects(&self, mask: &Mask) -> Vec<Rectangle<i32, Logical>> {
        let mut out = Vec::new();
        if mask.is_empty() {
            return out;
        }
        self.whole_window_rects(mask, &mut out);
        self.field_rects(mask, &mut out);
        self.popup_blanks(mask, &mut out);
        self.layer_rects(mask, &mut out);
        out
    }

    /// Whole windows: their content with popups, their title bars, and the shell's pictures of them.
    fn whole_window_rects(&self, mask: &Mask, out: &mut Vec<Rectangle<i32, Logical>>) {
        for id in &mask.windows {
            let Some((window, outer, by)) = self.drawn(*id) else {
                continue;
            };
            let geometry = window.geometry();
            let bar = f64::from(self.bar_height(&window)) * by;
            let content = outer.loc + Point::from((0.0, bar));
            let bbox = window.bbox_with_popups();
            let at = content + (bbox.loc - geometry.loc).to_f64().upscale(by);
            out.push(outward(Rectangle::new(at, bbox.size.to_f64().upscale(by))));
            if bar > 0.0 {
                out.push(outward(Rectangle::new(
                    outer.loc,
                    (outer.size.w, bar).into(),
                )));
            }
            out.extend(self.pictures_of(*id));
        }
    }

    /// Rectangles, global or in a window's content coordinates.
    fn field_rects(&self, mask: &Mask, out: &mut Vec<Rectangle<i32, Logical>>) {
        for (window, rect) in &mask.rects {
            let Some(id) = window else {
                out.push(*rect);
                continue;
            };
            // A window that isn't drawn shows nothing to blank.
            if let Some((window, outer, by)) = self.drawn(*id) {
                let bar = f64::from(self.bar_height(&window)) * by;
                let content = outer.loc + Point::from((0.0, bar));
                let at = content + rect.loc.to_f64().upscale(by);
                let field = outward(Rectangle::new(at, rect.size.to_f64().upscale(by)));
                // Where an opaque window in front covers the field, its blank would only hide that window.
                out.extend(Rectangle::subtract_rects_many([field], self.covered(*id)));
            }
            out.extend(self.pictures_of(*id));
        }
    }

    /// Popups blanked without their window, and those kept blanked while they live.
    fn popup_blanks(&self, mask: &Mask, out: &mut Vec<Rectangle<i32, Logical>>) {
        if mask.popups.is_empty() && mask.kept.is_empty() {
            return;
        }
        for id in self.windows.ids() {
            let whole = mask.popups.contains(&id);
            out.extend(
                self.popup_rects(id)
                    .into_iter()
                    .filter(|(surface, _)| whole || mask.kept.contains(surface))
                    .map(|(_, rect)| rect),
            );
        }
    }

    /// Shell layer surfaces named in the mask.
    fn layer_rects(&self, mask: &Mask, out: &mut Vec<Rectangle<i32, Logical>>) {
        for output in self.space.outputs() {
            let Some(origin) = self.space.output_geometry(output).map(|g| g.loc) else {
                continue;
            };
            let layers = layer_map_for_output(output);
            for layer in layers.layers() {
                if mask.layers.iter().any(|name| name == layer.namespace())
                    && let Some(geometry) = layers.layer_geometry(layer)
                {
                    out.push(Rectangle::new(geometry.loc + origin, geometry.size));
                }
            }
        }
    }

    /// A masked window as drawn now: the window, its outer frame there, and its scale.
    pub(in crate::render) fn drawn(
        &self,
        id: u64,
    ) -> Option<(smithay::desktop::Window, Rectangle<f64, Logical>, f64)> {
        let window = self.windows.get(id)?.window.clone();
        let (outer, by) = self.drawn_frame(id)?;
        Some((window, outer, by))
    }

    /// The shell's live pictures that show window `id`, blanked whole.
    fn pictures_of(&self, id: u64) -> Vec<Rectangle<i32, Logical>> {
        self.windows
            .get(id)
            .map(|entry| self.thumbnails.showing(id, entry.space))
            .unwrap_or_default()
    }
}
