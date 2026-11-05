//! `capture-mask`: what is blanked in the pictures a client gets, like
//! Android's FLAG_SECURE but only for that client. The shell decides what
//! (password fields, consent sheets, the vault's windows, a window handed to
//! the person) and for whom (its agents' screenshots, by name, and the
//! screencopy clients it started for them, by pid); this paints those areas
//! opaque in the picture before anyone sees it. Whatever moves in ways the
//! mask can't follow (the overview, a Space sliding, a window flying to the
//! Dock) blanks the whole picture instead.

use std::collections::HashMap;

use serde_json::{Map, Value};
use smithay::{
    desktop::layer_map_for_output,
    utils::{Logical, Rectangle},
};

use super::capture::Picture;
use crate::{state::Dashi, wm::valid_frame};

/// The most entries of each kind one mask holds.
const MAX_ENTRIES: usize = 256;
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
}

impl Mask {
    fn is_empty(&self) -> bool {
        self.windows.is_empty() && self.rects.is_empty() && self.layers.is_empty()
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

fn list<'a>(params: &'a Map<String, Value>, key: &str) -> Result<&'a [Value], String> {
    match params.get(key) {
        None | Some(Value::Null) => Ok(&[]),
        Some(Value::Array(items)) if items.len() <= MAX_ENTRIES => Ok(items),
        Some(_) => Err(format!("`{key}` must be a list of at most {MAX_ENTRIES}")),
    }
}

fn integer(value: &Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && v.abs() <= f64::from(1 << 16))
        .map(|v| v.round() as i64)
        .ok_or_else(|| format!("a rect needs a numeric `{key}`"))
}

/// `capture-mask {client, windows?, rects?, layers?, pids?}`; a mask with
/// nothing in it is dropped.
pub(crate) fn parse(params: &Map<String, Value>) -> Result<(String, Mask), String> {
    let client = params
        .get("client")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty() && c.len() <= 64)
        .ok_or("`client` must name whose captures are masked")?
        .to_owned();
    let ids = |key: &str| -> Result<Vec<u64>, String> {
        list(params, key)?
            .iter()
            .map(|v| v.as_u64().ok_or_else(|| format!("`{key}` must be ids")))
            .collect()
    };
    let windows = ids("windows")?;
    let pids = ids("pids")?.into_iter().map(|p| p as u32).collect();
    let layers = list(params, "layers")?
        .iter()
        .map(|v| {
            v.as_str()
                .filter(|s| s.len() <= 128)
                .map(str::to_owned)
                .ok_or_else(|| "`layers` must be namespaces".to_string())
        })
        .collect::<Result<_, _>>()?;
    let rects = list(params, "rects")?
        .iter()
        .map(|r| {
            let window = match r.get("window") {
                None | Some(Value::Null) => None,
                Some(v) => Some(v.as_u64().ok_or("a rect's `window` must be an id")?),
            };
            let frame = valid_frame(
                integer(r, "x")?,
                integer(r, "y")?,
                integer(r, "width")?,
                integer(r, "height")?,
            )
            .ok_or("a rect needs a positive size")?;
            Ok((window, frame))
        })
        .collect::<Result<_, String>>()?;
    Ok((
        client,
        Mask {
            windows,
            rects,
            layers,
            pids,
        },
    ))
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
    pub(crate) fn set_capture_mask(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let (client, mask) = parse(params)?;
        if mask.is_empty() && mask.pids.is_empty() {
            self.capture_masks.0.remove(&client);
        } else {
            self.capture_masks.0.insert(client, mask);
        }
        Ok(())
    }

    /// The global areas `mask` covers now; None when only the whole picture is safe.
    pub(crate) fn mask_rects(&self, mask: &Mask) -> Option<Vec<Rectangle<i32, Logical>>> {
        if mask.is_empty() {
            return Some(Vec::new());
        }
        if self.overview_open() || self.spaces.slide.is_some() || !self.motion.flights.is_empty() {
            return None;
        }
        let mut out = Vec::new();
        let content = |id: u64| {
            let window = &self.windows.get(id)?.window;
            let at = self.space.element_location(window)?;
            Some((window.clone(), at))
        };
        for id in &mask.windows {
            let Some((window, at)) = content(*id) else {
                continue;
            };
            let geometry = window.geometry();
            let mut bbox = window.bbox_with_popups();
            bbox.loc += at - geometry.loc;
            out.push(bbox);
            let bar = self.bar_height(&window);
            if bar > 0 {
                out.push(Rectangle::new(
                    (at.x, at.y - bar).into(),
                    (geometry.size.w, bar).into(),
                ));
            }
        }
        for (window, rect) in &mask.rects {
            match window {
                None => out.push(*rect),
                Some(id) => {
                    // A window that isn't on screen shows nothing to blank.
                    if let Some((_, at)) = content(*id) {
                        out.push(Rectangle::new(rect.loc + at, rect.size));
                    }
                }
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
        Some(out)
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
        blank(picture, area, scale, rects.as_deref());
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

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

    #[test]
    fn masks_parse_and_bad_ones_are_refused() {
        let params = |v: Value| v.as_object().cloned().unwrap();
        let (client, mask) = parse(&params(json!({
            "client": "agent",
            "windows": [3],
            "rects": [{ "window": 3, "x": 10, "y": 20, "width": 200, "height": 30 }, { "x": 0, "y": 0, "width": 5, "height": 5 }],
            "layers": ["dashi.agent-consent"],
            "pids": [4242],
        })))
        .unwrap();
        assert_eq!(client, "agent");
        assert_eq!(mask.windows, vec![3]);
        assert_eq!(mask.rects[0].0, Some(3));
        assert_eq!(mask.rects[1].0, None);
        assert_eq!(mask.pids, vec![4242]);
        assert!(parse(&params(json!({ "windows": [1] }))).is_err());
        assert!(
            parse(&params(
                json!({ "client": "agent", "rects": [{ "x": 0, "y": 0, "width": 0, "height": 5 }] })
            ))
            .is_err()
        );
        assert!(parse(&params(json!({ "client": "agent", "windows": ["w3"] }))).is_err());
        let many: Vec<u64> = (0..300).collect();
        assert!(parse(&params(json!({ "client": "agent", "windows": many }))).is_err());
    }
}
