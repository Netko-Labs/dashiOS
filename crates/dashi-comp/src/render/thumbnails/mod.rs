//! Live, scaled pictures the shell places: each Desktop's windows and
//! wallpaper in Mission Control's row (`space-previews`), and windows in the
//! app switcher, the share picker and the launcher (`window-thumbnails`). The shell says
//! where each picture goes (global logical rects); dashi-comp draws it there,
//! in front of the shell's own surfaces (its panels are opaque, so the
//! pictures can't be under them) and behind the pointer, every frame while
//! the rects are set, until the shell sends empty ones. What a picture means
//! and where it goes is the shell's (packages/shell/src/spaces/,
//! switcher/); this only draws.

mod draw;
mod element;

use std::collections::HashMap;

use smithay::{
    backend::renderer::element::Id,
    utils::{Logical, Point, Rectangle, Size},
};

pub(crate) use draw::thumbnail_elements;
pub(crate) use element::Thumb;

use crate::{
    ipc::protocol::{Coord, SpacePreviews, WindowThumbnails},
    state::Dashi,
    wm::WindowId,
};

/// More pictures than any panel of the shell's shows.
const MOST: usize = 64;
/// Element ids kept before the map starts over (surfaces come and go while a panel is up).
const MOST_IDS: usize = 4096;

/// A picture's rect, global logical.
type Rect = Rectangle<i32, Logical>;

/// A Desktop's picture: which Space, where, and which screen of it (by name).
#[derive(Clone)]
pub(crate) struct Preview {
    pub space: usize,
    pub rect: Rect,
    pub screen: String,
}

#[derive(Default)]
pub(crate) struct Thumbnails {
    /// Per screen name, the Desktop pictures drawn on it.
    previews: HashMap<String, Vec<Preview>>,
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

    /// Every picture that shows `window` (on Space `space`): its window
    /// pictures and the Desktop pictures of its Space, for a capture mask
    /// to blank whole (render/mask.rs).
    pub(crate) fn showing(&self, window: WindowId, space: usize) -> Vec<Rect> {
        let windows = self
            .windows
            .iter()
            .filter(|(id, _)| *id == window)
            .map(|(_, rect)| *rect);
        let desktops = self
            .previews
            .values()
            .flatten()
            .filter(|preview| preview.space == space)
            .map(|preview| preview.rect);
        windows.chain(desktops).collect()
    }

    /// The Spaces with a picture on any screen.
    pub(crate) fn previewed_spaces(&self) -> impl Iterator<Item = usize> + '_ {
        self.previews
            .values()
            .flatten()
            .map(|preview| preview.space)
    }
}

/// A rect as the requests send it: `{x, y, w, h}`, a positive size.
fn sized(x: Coord, y: Coord, w: Coord, h: Coord) -> Option<Rect> {
    (w.get() > 0 && h.get() > 0)
        .then(|| Rectangle::new((x.i32(), y.i32()).into(), (w.i32(), h.i32()).into()))
}

/// At most `MOST` rects, each a positive size.
fn checked<T>(
    list: &[T],
    key: &str,
    each: impl Fn(&T) -> Option<(u64, Rect)>,
) -> Result<Vec<(u64, Rect)>, String> {
    if list.len() > MOST {
        return Err(format!("at most {MOST} rects"));
    }
    list.iter()
        .map(each)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| format!("each rect needs `{key}`, x, y, and a positive w and h"))
}

fn window_rects(params: &WindowThumbnails) -> Result<Vec<(u64, Rect)>, String> {
    checked(&params.rects, "window", |r| {
        Some((r.window.to::<u64>(), sized(r.x, r.y, r.w, r.h)?))
    })
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
    /// `space-previews {output, rects: [{space, x, y, w, h, screen?}]}`: drawn on
    /// `output`, each a picture of Space `space` as screen `screen` shows it
    /// (`output` itself when left out); empty rects clear that screen's.
    pub(crate) fn set_space_previews(&mut self, params: &SpacePreviews) -> Result<(), String> {
        let output = params.output.as_str();
        if !self.space.outputs().any(|o| o.name() == output) {
            return Err(format!("no screen {output:?}"));
        }
        let list = checked(&params.rects, "space", |r| {
            Some((r.space.to::<u64>(), sized(r.x, r.y, r.w, r.h)?))
        })?;
        let mut previews = Vec::with_capacity(list.len());
        for ((space, rect), entry) in list.into_iter().zip(&params.rects) {
            let screen = match &entry.screen {
                None => output.to_owned(),
                Some(name) if self.space.outputs().any(|o| o.name() == *name) => name.clone(),
                Some(_) => return Err("`screen` must be a screen's name".into()),
            };
            previews.push(Preview {
                space: usize::try_from(space).unwrap_or_default(),
                rect,
                screen,
            });
        }
        if previews.is_empty() {
            self.thumbnails.previews.remove(output);
        } else {
            self.thumbnails.previews.insert(output.to_owned(), previews);
        }
        self.thumbnails_changed();
        Ok(())
    }

    /// `window-thumbnails {rects: [{window, x, y, w, h}]}`; empty rects clear them.
    /// Windows that are gone (closed since the shell looked) are left out.
    pub(crate) fn set_window_thumbnails(
        &mut self,
        params: &WindowThumbnails,
    ) -> Result<(), String> {
        let list = window_rects(params)?;
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

    fn rects(value: serde_json::Value) -> Result<Vec<(u64, Rect)>, String> {
        window_rects(&crate::ipc::protocol::read(value)?)
    }

    #[test]
    fn rects_are_checked() {
        let ok = json!({ "rects": [{ "window": 3, "x": 10, "y": 20.4, "w": 160, "h": 90 }] });
        assert_eq!(
            rects(ok),
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
            assert!(rects(bad.clone()).is_err(), "{bad}");
        }
        assert_eq!(rects(json!({ "rects": [] })), Ok(vec![]));
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
