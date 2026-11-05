//! Live, scaled pictures the shell places: each Desktop's windows and
//! wallpaper in Mission Control's row (`space-previews`), and windows in the
//! app switcher and the share picker (`window-thumbnails`). The shell says
//! where each picture goes (global logical rects); dashi-comp draws it there,
//! in front of the shell's own surfaces (its panels are opaque, so the
//! pictures can't be under them) and behind the pointer, every frame while
//! the rects are set, until the shell sends empty ones. What a picture means
//! and where it goes is the shell's (packages/shell/src/spaces/,
//! switcher/); this only draws.

mod draw;
mod element;

use std::collections::HashMap;

use serde_json::{Map, Value};
use smithay::{
    backend::renderer::element::Id,
    utils::{Logical, Point, Rectangle, Size},
};

pub(crate) use draw::thumbnail_elements;
pub(crate) use element::Thumb;

use crate::{state::Dashi, wm::WindowId};

/// More pictures than any panel of the shell's shows.
const MOST: usize = 64;
/// Element ids kept before the map starts over (surfaces come and go while a panel is up).
const MOST_IDS: usize = 4096;

/// A picture's rect, global logical.
type Rect = Rectangle<i32, Logical>;

#[derive(Default)]
pub(crate) struct Thumbnails {
    /// Per screen name, each Desktop's picture: (Space, rect).
    previews: HashMap<String, Vec<(usize, Rect)>>,
    /// Window pictures: (window, rect).
    windows: Vec<(WindowId, Rect)>,
    /// A steady id per (picture, element shown in it), so damage is tracked per picture.
    ids: HashMap<(usize, Id), Id>,
}

impl Thumbnails {
    pub(crate) fn is_empty(&self) -> bool {
        self.previews.is_empty() && self.windows.is_empty()
    }

    /// The id for element `source` in picture `slot`, the same every frame.
    fn id(&mut self, slot: usize, source: &Id) -> Id {
        if self.ids.len() > MOST_IDS {
            self.ids.clear();
        }
        self.ids
            .entry((slot, source.clone()))
            .or_insert_with(Id::new)
            .clone()
    }

    /// The windows in window pictures (they hear frame callbacks even off screen).
    pub(crate) fn window_ids(&self) -> impl Iterator<Item = WindowId> + '_ {
        self.windows.iter().map(|(id, _)| *id)
    }

    /// The Spaces with a picture on any screen.
    pub(crate) fn previewed_spaces(&self) -> impl Iterator<Item = usize> + '_ {
        self.previews.values().flatten().map(|(space, _)| *space)
    }
}

/// A rect as the requests send it: `{x, y, w, h}`, a positive size, in range.
fn rect(value: &Map<String, Value>) -> Option<Rectangle<i32, Logical>> {
    let get = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && v.abs() < f64::from(1 << 16))
            .map(|v| v.round() as i32)
    };
    let (x, y, w, h) = (get("x")?, get("y")?, get("w")?, get("h")?);
    (w > 0 && h > 0).then(|| Rectangle::new((x, y).into(), (w, h).into()))
}

/// The `rects` list of a request: each entry's `key` (a non-negative integer) and rect.
fn rects(params: &Map<String, Value>, key: &str) -> Result<Vec<(u64, Rect)>, String> {
    let list = params
        .get("rects")
        .and_then(Value::as_array)
        .ok_or("`rects` must be a list")?;
    if list.len() > MOST {
        return Err(format!("at most {MOST} rects"));
    }
    list.iter()
        .map(|entry| {
            let entry = entry.as_object()?;
            Some((entry.get(key)?.as_u64()?, rect(entry)?))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| format!("each rect needs `{key}`, x, y, and a positive w and h"))
}

/// Where a window's outer frame of `size` goes in a picture `rect`: as large
/// as fits, never larger than it is, centered.
pub(crate) fn fit(
    size: Size<i32, Logical>,
    rect: Rectangle<i32, Logical>,
) -> Rectangle<f64, Logical> {
    let (w, h) = (f64::from(size.w.max(1)), f64::from(size.h.max(1)));
    let by = (f64::from(rect.size.w) / w)
        .min(f64::from(rect.size.h) / h)
        .min(1.0);
    let (fw, fh) = (w * by, h * by);
    let loc = rect.loc.to_f64()
        + Point::from((
            (f64::from(rect.size.w) - fw) / 2.0,
            (f64::from(rect.size.h) - fh) / 2.0,
        ));
    Rectangle::new(loc, (fw, fh).into())
}

/// Where `frame`, on a screen at `screen`, is drawn in that screen's picture `rect`.
pub(crate) fn on_preview(
    screen: Rectangle<i32, Logical>,
    rect: Rectangle<i32, Logical>,
    frame: Rectangle<i32, Logical>,
) -> Rectangle<f64, Logical> {
    let by = f64::from(rect.size.w) / f64::from(screen.size.w.max(1));
    let at = (frame.loc - screen.loc).to_f64();
    Rectangle::new(
        rect.loc.to_f64() + Point::from((at.x * by, at.y * by)),
        (f64::from(frame.size.w) * by, f64::from(frame.size.h) * by).into(),
    )
}

impl Dashi {
    /// `space-previews {output, rects: [{space, x, y, w, h}]}`; empty rects clear that screen's.
    pub(crate) fn set_space_previews(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let output = params
            .get("output")
            .and_then(Value::as_str)
            .ok_or("`output` must be a screen's name")?;
        if !self.space.outputs().any(|o| o.name() == output) {
            return Err(format!("no screen {output:?}"));
        }
        let list = rects(params, "space")?;
        if list
            .iter()
            .any(|(space, _)| *space >= crate::wm::MAX_SPACES as u64)
        {
            return Err("`space` must be a Space's index".into());
        }
        if list.is_empty() {
            self.thumbnails.previews.remove(output);
        } else {
            let list = list.into_iter().map(|(s, r)| (s as usize, r)).collect();
            self.thumbnails.previews.insert(output.to_owned(), list);
        }
        self.thumbnails_changed();
        Ok(())
    }

    /// `window-thumbnails {rects: [{window, x, y, w, h}]}`; empty rects clear them.
    /// Windows that are gone (closed since the shell looked) are left out.
    pub(crate) fn set_window_thumbnails(
        &mut self,
        params: &Map<String, Value>,
    ) -> Result<(), String> {
        let list = rects(params, "window")?;
        self.thumbnails.windows = list
            .into_iter()
            .filter(|(id, _)| self.windows.get(*id).is_some_and(|e| e.announced))
            .collect();
        self.thumbnails_changed();
        Ok(())
    }

    /// Windows in a picture that are not on screen (another Desktop's, minimized, hidden).
    pub(crate) fn pictured_off_screen(&self) -> Vec<smithay::desktop::Window> {
        if self.thumbnails.is_empty() {
            return Vec::new();
        }
        let spaces: Vec<usize> = self.thumbnails.previewed_spaces().collect();
        let ids: Vec<WindowId> = self.thumbnails.window_ids().collect();
        self.windows
            .entries()
            .filter(|e| ids.contains(&e.id) || spaces.contains(&e.space))
            .filter(|e| self.space.element_location(&e.window).is_none())
            .map(|e| e.window.clone())
            .collect()
    }

    fn thumbnails_changed(&mut self) {
        if self.thumbnails.is_empty() {
            self.thumbnails.ids.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn params(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            _ => Map::new(),
        }
    }

    #[test]
    fn rects_are_checked() {
        let ok =
            params(json!({ "rects": [{ "window": 3, "x": 10, "y": 20.4, "w": 160, "h": 90 }] }));
        assert_eq!(
            rects(&ok, "window"),
            Ok(vec![(3, Rectangle::new((10, 20).into(), (160, 90).into()))])
        );
        for bad in [
            json!({ "rects": [{ "window": 3, "x": 10, "y": 20, "w": 0, "h": 90 }] }),
            json!({ "rects": [{ "window": -1, "x": 10, "y": 20, "w": 10, "h": 90 }] }),
            json!({ "rects": [{ "x": 10, "y": 20, "w": 10, "h": 90 }] }),
            json!({ "rects": [{ "window": 3, "x": 1e9, "y": 20, "w": 10, "h": 90 }] }),
            json!({ "rects": 4 }),
            json!({}),
        ] {
            assert!(rects(&params(bad.clone()), "window").is_err(), "{bad}");
        }
        assert_eq!(rects(&params(json!({ "rects": [] })), "space"), Ok(vec![]));
    }

    #[test]
    fn a_window_fits_its_picture_centered_and_never_grows() {
        let picture = Rectangle::new((100, 100).into(), (200, 100).into());
        let wide = fit((1000, 400).into(), picture);
        assert_eq!(wide.size.w, 200.0);
        assert_eq!(wide.size.h, 80.0);
        assert_eq!(wide.loc.y, 110.0, "centered top to bottom");
        let small = fit((50, 20).into(), picture);
        assert_eq!((small.size.w, small.size.h), (50.0, 20.0));
        assert_eq!((small.loc.x, small.loc.y), (175.0, 140.0));
    }

    #[test]
    fn a_desktop_picture_is_its_screen_scaled() {
        let screen = Rectangle::new((1920, 0).into(), (1920, 1080).into());
        let picture = Rectangle::new((2000, 40).into(), (192, 108).into());
        let frame = Rectangle::new((2880, 540).into(), (960, 540).into());
        let drawn = on_preview(screen, picture, frame);
        assert_eq!((drawn.loc.x, drawn.loc.y), (2096.0, 94.0));
        assert_eq!((drawn.size.w, drawn.size.h), (96.0, 54.0));
    }
}
