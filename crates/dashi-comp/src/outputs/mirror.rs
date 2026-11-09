//! `mirror`: one screen shows another's picture, scaled to fit and
//! letterboxed (black bars where the shapes differ). Which screen mirrors
//! which, and when, is the shell's (packages/shell/src/display-config/
//! mirror.ts); this only draws. A screen that mirrors leaves the space: no
//! window, layer surface or pointer is on it, and the screen it shows keeps
//! the desktop. It stays lit and keeps its mode; the backend draws it with
//! the source's elements (render/scene.rs, `output_elements`). It comes back
//! where it was when mirroring stops, and by itself when the screen it
//! shows goes away.

use serde_json::{Map, Value};
use smithay::{
    backend::renderer::element::solid::SolidColorBuffer,
    output::Output,
    utils::{Logical, Physical, Point, Rectangle, Size},
};

use crate::state::Dashi;

/// The bars around the picture.
pub(crate) const BAR: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

/// One screen showing another.
pub(crate) struct Mirror {
    pub target: Output,
    /// The screen it shows, by name.
    pub source: String,
    /// Where it was in the space before, to go back to.
    at: Point<i32, Logical>,
    /// The letterbox's bars: steady buffers, so their damage is tracked.
    pub bars: [SolidColorBuffer; 4],
}

#[derive(Default)]
pub(crate) struct Mirrors(Vec<Mirror>);

impl Mirrors {
    pub(crate) fn of(&self, target: &Output) -> Option<&Mirror> {
        self.0.iter().find(|mirror| &mirror.target == target)
    }

    pub(crate) fn of_mut(&mut self, target: &Output) -> Option<&mut Mirror> {
        self.0.iter_mut().find(|mirror| &mirror.target == target)
    }

    /// The screens that mirror another (not in the space).
    pub(crate) fn targets(&self) -> impl Iterator<Item = &Output> {
        self.0.iter().map(|mirror| &mirror.target)
    }

    pub(crate) fn source_of(&self, target: &Output) -> Option<&str> {
        self.of(target).map(|mirror| mirror.source.as_str())
    }

    fn take(&mut self, target: &Output) -> Option<Mirror> {
        let at = self.0.iter().position(|mirror| &mirror.target == target)?;
        Some(self.0.remove(at))
    }
}

/// How a source `source` logical points across is drawn on a target
/// `target` pixels across: the scale (target pixels a source point) that
/// fits it whole, and where its top left goes, centered.
pub(crate) fn letterbox(
    source: Size<i32, Logical>,
    target: Size<i32, Physical>,
) -> (f64, Point<f64, Physical>) {
    let (sw, sh) = (f64::from(source.w.max(1)), f64::from(source.h.max(1)));
    let (tw, th) = (f64::from(target.w.max(1)), f64::from(target.h.max(1)));
    let scale = (tw / sw).min(th / sh);
    let at = Point::from(((tw - sw * scale) / 2.0, (th - sh * scale) / 2.0));
    (scale, at)
}

/// The bars around a picture at `picture` on a target `target` pixels
/// across: left, right, top, bottom (empty where the picture reaches the edge).
pub(crate) fn bars(
    picture: Rectangle<i32, Physical>,
    target: Size<i32, Physical>,
) -> [Rectangle<i32, Physical>; 4] {
    let left = picture.loc.x.clamp(0, target.w);
    let top = picture.loc.y.clamp(0, target.h);
    let right = (picture.loc.x + picture.size.w).clamp(left, target.w);
    let bottom = (picture.loc.y + picture.size.h).clamp(top, target.h);
    [
        Rectangle::new((0, 0).into(), (left, target.h).into()),
        Rectangle::new((right, 0).into(), (target.w - right, target.h).into()),
        Rectangle::new((left, 0).into(), (right - left, top).into()),
        Rectangle::new(
            (left, bottom).into(),
            (right - left, target.h - bottom).into(),
        ),
    ]
}

/// A screen's size in pixels as it is drawn (a screen on its side is taller than wide).
pub(crate) fn drawn_size(output: &Output) -> Option<Size<i32, Physical>> {
    let mode = output.current_mode()?;
    Some(output.current_transform().transform_size(mode.size))
}

impl Dashi {
    /// `mirror {output, source}`: `output` shows `source` (a screen's name),
    /// or its own desktop again (`source: null`).
    pub(crate) fn set_mirror(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let name = params
            .get("output")
            .and_then(Value::as_str)
            .ok_or("`output` must be a screen's name")?;
        let source = match params.get("source") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .ok_or("`source` must be a screen's name or null")?,
            ),
        };
        let mirrored = self.mirrors.targets().find(|o| o.name() == name).cloned();
        let target = mirrored
            .clone()
            .or_else(|| self.space.outputs().find(|o| o.name() == name).cloned())
            .ok_or_else(|| format!("no screen {name:?} that is on"))?;
        let Some(source) = source else {
            self.stop_mirror(&target);
            return Ok(());
        };
        if source == name {
            return Err("a screen can't mirror itself".into());
        }
        if !self.space.outputs().any(|o| o.name() == source) {
            return Err(format!("no screen {source:?} showing a desktop"));
        }
        if self.mirrors.0.iter().any(|m| m.source == name) {
            return Err(format!("{name} is mirrored: stop that first"));
        }
        if let Some(mirror) = self.mirrors.of_mut(&target) {
            mirror.source = source.to_owned();
        } else {
            let at = self
                .space
                .output_geometry(&target)
                .map(|g| g.loc)
                .unwrap_or_default();
            self.space.unmap_output(&target);
            self.mirrors.0.push(Mirror {
                target,
                source: source.to_owned(),
                at,
                bars: std::array::from_fn(|_| SolidColorBuffer::new((0, 0), BAR)),
            });
        }
        self.mirrors_changed();
        Ok(())
    }

    /// `target` shows its own desktop again, where it was.
    fn stop_mirror(&mut self, target: &Output) {
        let Some(mirror) = self.mirrors.take(target) else {
            return;
        };
        self.space.map_output(&mirror.target, mirror.at);
        self.mirrors_changed();
    }

    /// A screen is gone (unplugged, its GPU gone): it mirrors nothing, and
    /// the screens that showed it show their own desktops again.
    pub(crate) fn mirror_output_gone(&mut self, output: &Output) {
        let had = self.mirrors.take(output).is_some();
        let name = output.name();
        let orphans: Vec<Output> = self
            .mirrors
            .0
            .iter()
            .filter(|m| m.source == name)
            .map(|m| m.target.clone())
            .collect();
        for target in &orphans {
            self.stop_mirror(target);
        }
        if had && orphans.is_empty() {
            self.mirrors_changed();
        }
    }

    /// Before `outputs-config` turns a screen on or off: one that mirrors stops (it
    /// is back in the space, where it was), so the arrangement applies to it as to any other.
    pub(crate) fn unmirror_for_config(&mut self, output: &Output) {
        if let Some(mirror) = self.mirrors.take(output) {
            self.space.map_output(&mirror.target, mirror.at);
        }
    }

    fn mirrors_changed(&mut self) {
        for output in self.space.outputs().cloned().collect::<Vec<_>>() {
            smithay::desktop::layer_map_for_output(&output).arrange();
        }
        self.ipc.emit("outputs-changed", serde_json::json!({}));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wide_screen_on_a_taller_one_gets_bars_above_and_below() {
        let (scale, at) = letterbox((1920, 1080).into(), (1280, 1024).into());
        assert!((scale - 1280.0 / 1920.0).abs() < 1e-9);
        assert_eq!(at.x, 0.0);
        assert_eq!(at.y, (1024.0 - 720.0) / 2.0);
    }

    #[test]
    fn a_laptop_on_a_4k_tv_fills_its_height_with_bars_beside() {
        // A 16:10 panel at scale 2 (1440 × 900 points) on a 3840 × 2160 TV.
        let (scale, at) = letterbox((1440, 900).into(), (3840, 2160).into());
        assert_eq!(scale, 2.4);
        assert_eq!(at.y, 0.0);
        assert_eq!(at.x, (3840.0 - 1440.0 * 2.4) / 2.0);
    }

    #[test]
    fn the_same_shape_has_no_bars() {
        let (scale, at) = letterbox((1920, 1080).into(), (3840, 2160).into());
        assert_eq!((scale, at.x, at.y), (2.0, 0.0, 0.0));
        let picture = Rectangle::new((0, 0).into(), (3840, 2160).into());
        assert!(
            bars(picture, (3840, 2160).into())
                .iter()
                .all(|bar| bar.size.w == 0 || bar.size.h == 0)
        );
    }

    #[test]
    fn bars_cover_exactly_what_the_picture_leaves() {
        let target: Size<i32, Physical> = (1280, 1024).into();
        let picture = Rectangle::new((0, 152).into(), (1280, 720).into());
        let [left, right, top, bottom] = bars(picture, target);
        assert_eq!(left.size.w, 0);
        assert_eq!(right.size.w, 0);
        assert_eq!(top, Rectangle::new((0, 0).into(), (1280, 152).into()));
        assert_eq!(bottom, Rectangle::new((0, 872).into(), (1280, 152).into()));
        let area: i32 = [left, right, top, bottom]
            .iter()
            .map(|bar| bar.size.w * bar.size.h)
            .sum();
        assert_eq!(area + 1280 * 720, 1280 * 1024);
    }
}
