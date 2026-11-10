//! `capture-mask`: what is blanked in the pictures a client gets, like
//! Android's FLAG_SECURE but only for that client. The shell decides what
//! (password fields, consent sheets, the vault's windows, a window handed to
//! the person) and for whom (its agents' screenshots, by name, and the
//! screencopy clients it started for them, by pid); this paints those areas
//! opaque in the picture before anyone sees it, where it is drawn: in its
//! frame, small in the overview, flying to the Dock, sliding with its Space
//! (drawn.rs), and in any live picture of the shell's that shows it
//! (thumbnails/), which is blanked whole. A window's popups may be blanked
//! without the window (after Dashi typed a card or a password into it: a
//! browser's "save this card?" prompt), and a popup blanked once stays
//! blanked while it lives. A field's blank stops where an opaque window in
//! front covers it (mask_cover.rs).

use std::collections::HashMap;

use smithay::{
    desktop::layer_map_for_output,
    reexports::wayland_server::{Resource, protocol::wl_surface::WlSurface},
    utils::{Logical, Point, Rectangle},
};

use super::capture::Picture;
pub(crate) use super::mask_params::CaptureMask;
use super::mask_params::parse;
use crate::state::Dashi;

/// The most entries of each kind one mask holds.
/// What a blanked area is painted: an opaque dark gray, plainly not content.
const BLANK: [u8; 4] = [38, 38, 42, 255];

#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct Mask {
    /// Whole windows (and their popups and title bars).
    pub windows: Vec<u64>,
    /// Rectangles, in a window's content coordinates when `window` is set, else global.
    pub rects: Vec<(Option<u64>, Rectangle<i32, Logical>)>,
    /// Shell layer surfaces, by namespace (`dashi.agent-consent`).
    pub layers: Vec<String>,
    /// Screencopy and image-copy clients whose frames get this mask.
    pub pids: Vec<u32>,
    /// Windows whose popups are blanked (not the windows).
    pub popups: Vec<u64>,
    /// Popups blanked by an earlier request, kept blanked while they live.
    pub kept: Vec<WlSurface>,
}

impl Mask {
    fn is_empty(&self) -> bool {
        self.windows.is_empty()
            && self.rects.is_empty()
            && self.layers.is_empty()
            && self.popups.is_empty()
            && self.kept.is_empty()
    }
}

/// Every client's mask, by the name the shell gave it ("agent").
#[derive(Default)]
pub(crate) struct Masks(HashMap<String, Mask>);

impl Masks {
    pub(crate) fn named(&self, name: &str) -> Option<&Mask> {
        self.0.get(name)
    }

    pub(crate) fn for_pid(&self, pid: u32) -> Option<&Mask> {
        self.0.values().find(|mask| mask.pids.contains(&pid))
    }
}

/// `rect` grown out to whole logical pixels: never a sliver of what is under it.
pub(super) fn outward(rect: Rectangle<f64, Logical>) -> Rectangle<i32, Logical> {
    let (x0, y0) = (rect.loc.x.floor(), rect.loc.y.floor());
    let (x1, y1) = (
        (rect.loc.x + rect.size.w).ceil(),
        (rect.loc.y + rect.size.h).ceil(),
    );
    Rectangle::new(
        (x0 as i32, y0 as i32).into(),
        ((x1 - x0) as i32, (y1 - y0) as i32).into(),
    )
}

/// Paint `rects` (global logical) opaque in `picture`, which shows `area` at `scale`.
/// `None` blanks all of it.
pub(crate) fn blank(
    picture: &mut Picture,
    area: Rectangle<i32, Logical>,
    scale: f64,
    rects: Option<&[Rectangle<i32, Logical>]>,
) {
    let (width, height) = (
        picture.width.max(0) as usize,
        picture.height.max(0) as usize,
    );
    let mut fill = |x0: usize, y0: usize, x1: usize, y1: usize| {
        for y in y0..y1.min(height) {
            let row = y * width * 4;
            for x in x0..x1.min(width) {
                picture.rgba[row + x * 4..row + x * 4 + 4].copy_from_slice(&BLANK);
            }
        }
    };
    let Some(rects) = rects else {
        fill(0, 0, width, height);
        return;
    };
    for rect in rects {
        let Some(on) = rect.intersection(area) else {
            continue;
        };
        // Outward to whole pixels: never a sliver of what is under it.
        let left = (f64::from(on.loc.x - area.loc.x) * scale).floor().max(0.0) as usize;
        let top = (f64::from(on.loc.y - area.loc.y) * scale).floor().max(0.0) as usize;
        let right = (f64::from(on.loc.x - area.loc.x + on.size.w) * scale).ceil() as usize;
        let bottom = (f64::from(on.loc.y - area.loc.y + on.size.h) * scale).ceil() as usize;
        fill(left, top, right, bottom);
    }
}

impl Dashi {
    pub(crate) fn set_capture_mask(&mut self, params: &CaptureMask) -> Result<(), String> {
        let (client, mut mask) = parse(params)?;
        // The popups blanked before stay blanked while they live, and so do those blanked now.
        let mut kept = self
            .capture_masks
            .0
            .get(&client)
            .map(|old| old.kept.clone())
            .unwrap_or_default();
        kept.retain(Resource::is_alive);
        for id in &mask.popups {
            for (surface, _) in self.popup_rects(*id) {
                if !kept.contains(&surface) {
                    kept.push(surface);
                }
            }
        }
        let over = kept.len().saturating_sub(super::mask_params::MAX_ENTRIES);
        kept.drain(..over);
        mask.kept = kept;
        if mask.is_empty() && mask.pids.is_empty() {
            self.capture_masks.0.remove(&client);
        } else {
            self.capture_masks.0.insert(client, mask);
        }
        Ok(())
    }

    /// The global areas `mask` covers now, wherever what it names is drawn.
    pub(crate) fn mask_rects(&self, mask: &Mask) -> Vec<Rectangle<i32, Logical>> {
        let mut out = Vec::new();
        if mask.is_empty() {
            return out;
        }
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
        if !mask.popups.is_empty() || !mask.kept.is_empty() {
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
        out
    }

    /// A masked window as drawn now: the window, its outer frame there, and its scale.
    pub(super) fn drawn(
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

    /// A screencopy or image-copy frame for `client`: blanked if the shell
    /// masked that client's process (a recorder it started for an agent).
    pub(crate) fn mask_for_client(
        &self,
        client: Option<smithay::reexports::wayland_server::Client>,
        area: Rectangle<i32, Logical>,
        scale: f64,
        picture: &mut Picture,
    ) {
        let pid = client
            .as_ref()
            .and_then(|c| c.get_data::<crate::state::ClientState>())
            .and_then(|data| data.pid)
            .and_then(|pid| u32::try_from(pid).ok());
        if let Some(mask) = pid.and_then(|pid| self.capture_masks.for_pid(pid)) {
            self.apply_mask(Some(mask), area, scale, picture);
        }
    }

    /// Blank what `mask` covers in a picture of `area`.
    pub(crate) fn apply_mask(
        &self,
        mask: Option<&Mask>,
        area: Rectangle<i32, Logical>,
        scale: f64,
        picture: &mut Picture,
    ) {
        let Some(mask) = mask else {
            return;
        };
        let rects = self.mask_rects(mask);
        blank(picture, area, scale, Some(&rects));
    }
}

#[cfg(test)]
mod tests {

    use super::*;

    fn picture(w: i32, h: i32) -> Picture {
        Picture {
            width: w,
            height: h,
            rgba: vec![255; (w * h * 4) as usize],
        }
    }

    fn blanked(p: &Picture) -> Vec<(i32, i32)> {
        (0..p.height)
            .flat_map(|y| (0..p.width).map(move |x| (x, y)))
            .filter(|(x, y)| {
                let i = ((y * p.width + x) * 4) as usize;
                p.rgba[i..i + 4] == BLANK
            })
            .collect()
    }

    #[test]
    fn rects_are_blanked_where_they_are_in_the_picture() {
        let mut p = picture(10, 10);
        let area = Rectangle::new((100, 100).into(), (10, 10).into());
        let rect = Rectangle::new((102, 103).into(), (2, 1).into());
        blank(&mut p, area, 1.0, Some(&[rect]));
        assert_eq!(blanked(&p), vec![(2, 3), (3, 3)]);
    }

    #[test]
    fn scaled_pictures_are_blanked_outward_to_whole_pixels() {
        let mut p = picture(15, 15);
        let area = Rectangle::new((0, 0).into(), (10, 10).into());
        // 1.5×: logical 1..2 is pixels 1.5..3, so 1, 2 (outward).
        blank(
            &mut p,
            area,
            1.5,
            Some(&[Rectangle::new((1, 1).into(), (1, 1).into())]),
        );
        assert_eq!(blanked(&p), vec![(1, 1), (2, 1), (1, 2), (2, 2)]);
    }

    #[test]
    fn rects_off_the_picture_change_nothing_and_none_blanks_it_all() {
        let mut p = picture(4, 4);
        let area = Rectangle::new((0, 0).into(), (4, 4).into());
        blank(
            &mut p,
            area,
            1.0,
            Some(&[Rectangle::new((50, 50).into(), (5, 5).into())]),
        );
        assert!(blanked(&p).is_empty());
        // Partly on: clipped to the picture.
        blank(
            &mut p,
            area,
            1.0,
            Some(&[Rectangle::new((3, 3).into(), (5, 5).into())]),
        );
        assert_eq!(blanked(&p), vec![(3, 3)]);
        blank(&mut p, area, 1.0, None);
        assert_eq!(blanked(&p).len(), 16);
    }
}
