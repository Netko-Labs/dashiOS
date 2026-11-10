//! The shell's requests for pictures (`space-previews`, `window-thumbnails`),
//! checked and kept.

use smithay::utils::Rectangle;

use super::store::{MOST, Preview, Rect};
use crate::{
    ipc::protocol::{Coord, SpacePreviews, WindowThumbnails},
    state::Dashi,
    wm::WindowId,
};

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
}
