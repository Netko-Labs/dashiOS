//! `window-style`: the look of the depth between windows, as the shell sends
//! it (docs/compositor-ipc.md). Every value is the shell's; until it sends
//! one, windows have no shadow, edge, or ring. Params are untrusted: each is
//! range-checked, and a bad one changes nothing.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::ipc::protocol::{Millis, Real};

/// One shadow, as CSS's `box-shadow` has it: an offset, a blur (a Gaussian
/// of sigma blur/2), a spread, in logical pixels; black at `alpha`.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Layer {
    pub x: f64,
    pub y: f64,
    pub blur: f64,
    pub spread: f64,
    pub alpha: f64,
}

/// Up to two layers drawn as one (the first over the second).
pub(crate) type Shadow = [Layer; 2];

/// A line along the window's rounded edge: its color (straight RGBA) and width.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Line {
    pub color: [f32; 4],
    pub width: f64,
}

impl Line {
    pub(crate) fn shows(&self) -> bool {
        self.width > 0.0 && self.color[3] > 0.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Style {
    /// The window with the keyboard (or whose sheet has it), and the rest;
    /// focus cross-fades between the two over `fade`.
    pub focused: Shadow,
    pub other: Shadow,
    /// A window framed with `tiled` (a tile) and with `maximized` (Fill).
    pub tiled: Shadow,
    pub filled: Shadow,
    /// A window attached as a sheet (`attach`).
    pub sheet: Shadow,
    /// Just inside every window's frame;
    pub edge: Line,
    /// a filled one's too (`edge.filled`, true unless false).
    pub edge_filled: bool,
    /// Just outside the focused window's frame, in place of its edge; off when it doesn't show.
    pub ring: Line,
    pub fade: Duration,
}

const MOST_LINE: f64 = 8.0;
const MOST_FADE_MS: u64 = 1000;

/// An offset or a spread, -128 to 128.
type Offset = Real<-128_000, 128_000>;
/// A blur, 0 to 128.
type Blur = Real<0, 128_000>;
/// An opacity, 0 to 1.
type Alpha = Real<0, 1000>;
/// A line's width, 0 to 8.
type LineWidth = Real<0, 8000>;

/// `window-style`'s params, the whole look each time: keys left out are none.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WindowStyle {
    pub shadow: Option<Shadows>,
    pub edge: Option<LineParams>,
    pub ring: Option<LineParams>,
    pub fade: Option<Millis<{ MOST_FADE_MS as i64 }>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Shadows {
    pub focused: Option<Vec<LayerParams>>,
    pub other: Option<Vec<LayerParams>>,
    pub tiled: Option<Vec<LayerParams>>,
    pub filled: Option<Vec<LayerParams>>,
    pub sheet: Option<Vec<LayerParams>>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LayerParams {
    pub x: Option<Offset>,
    pub y: Option<Offset>,
    pub blur: Option<Blur>,
    pub spread: Option<Offset>,
    pub alpha: Option<Alpha>,
}

/// A line: `{color, width}`; `on: false` (the ring) is none, and `filled`
/// (the edge) says whether a filled window has it too.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LineParams {
    pub color: Option<String>,
    pub width: Option<LineWidth>,
    pub on: Option<bool>,
    pub filled: Option<bool>,
}

/// A whole `window-style` request as the look it gives.
pub(crate) fn parse(params: &WindowStyle) -> Result<Style, String> {
    let shadows = params.shadow.clone().unwrap_or_default();
    let shadow = |key: &str, layers: &Option<Vec<LayerParams>>| -> Result<Shadow, String> {
        shadow(layers.as_deref()).map_err(|error| format!("shadow.{key}: {error}"))
    };
    Ok(Style {
        focused: shadow("focused", &shadows.focused)?,
        other: shadow("other", &shadows.other)?,
        tiled: shadow("tiled", &shadows.tiled)?,
        filled: shadow("filled", &shadows.filled)?,
        sheet: shadow("sheet", &shadows.sheet)?,
        edge: line(params.edge.as_ref()).map_err(|error| format!("edge: {error}"))?,
        edge_filled: params
            .edge
            .as_ref()
            .and_then(|edge| edge.filled)
            .unwrap_or(true),
        ring: line(params.ring.as_ref()).map_err(|error| format!("ring: {error}"))?,
        fade: Duration::from_millis(params.fade.map_or(0, |fade| fade.to::<u64>())),
    })
}

fn shadow(layers: Option<&[LayerParams]>) -> Result<Shadow, String> {
    let layers = layers.unwrap_or_default();
    if layers.len() > 2 {
        return Err("must be a list of up to two layers".into());
    }
    let mut shadow = Shadow::default();
    for (slot, layer) in shadow.iter_mut().zip(layers) {
        *slot = Layer {
            x: layer.x.map_or(0.0, Offset::get),
            y: layer.y.map_or(0.0, Offset::get),
            blur: layer.blur.map_or(0.0, Blur::get),
            spread: layer.spread.map_or(0.0, Offset::get),
            alpha: layer.alpha.map_or(0.0, Alpha::get),
        };
    }
    Ok(shadow)
}

fn line(params: Option<&LineParams>) -> Result<Line, String> {
    let Some(line) = params else {
        return Ok(Line::default());
    };
    if line.on == Some(false) {
        return Ok(Line::default());
    }
    let color = line
        .color
        .as_deref()
        .and_then(hex)
        .ok_or("`color` must be #rrggbb or #rrggbbaa")?;
    let width = line
        .width
        .map(LineWidth::get)
        .ok_or(format!("`width` must be 0 to {MOST_LINE}"))?;
    Ok(Line { color, width })
}

/// `#rrggbb` or `#rrggbbaa` as straight RGBA from 0 to 1.
pub(crate) fn hex(text: &str) -> Option<[f32; 4]> {
    let digits = text.strip_prefix('#')?;
    if !(digits.len() == 6 || digits.len() == 8) || !digits.is_ascii() {
        return None;
    }
    let channel = |at: usize| -> Option<f32> {
        digits
            .get(at..at + 2)
            .and_then(|pair| u8::from_str_radix(pair, 16).ok())
            .map(|v| f32::from(v) / 255.0)
    };
    let alpha = if digits.len() == 8 { channel(6)? } else { 1.0 };
    Some([channel(0)?, channel(2)?, channel(4)?, alpha])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn params(value: Value) -> Value {
        value
    }

    fn parse(value: Value) -> Result<Style, String> {
        super::parse(&crate::ipc::protocol::read(value)?)
    }

    #[test]
    fn colors() {
        assert_eq!(hex("#ffffff"), Some([1.0, 1.0, 1.0, 1.0]));
        assert_eq!(hex("#00000000"), Some([0.0, 0.0, 0.0, 0.0]));
        assert_eq!(hex("#3E8A72").map(|c| (c[1] * 255.0).round()), Some(138.0));
        assert_eq!(hex("fff"), None);
        assert_eq!(hex("#ggg000"), None);
        assert_eq!(hex("#éé0000"), None);
    }

    #[test]
    fn a_whole_style() {
        let style = parse(params(json!({
            "shadow": {
                "focused": [{"x": 0, "y": 18, "blur": 40, "spread": -8, "alpha": 0.38}, {"y": 2, "blur": 6, "alpha": 0.16}],
                "other": [{"y": 8, "blur": 20, "spread": -6, "alpha": 0.22}],
            },
            "edge": {"color": "#0000002b", "width": 1, "filled": false},
            "ring": {"on": false, "color": "#3E8A72", "width": 1.5},
            "fade": 150,
        })))
        .expect("a good style");
        assert_eq!(style.focused[0].blur, 40.0);
        assert_eq!(style.focused[1].y, 2.0);
        assert_eq!(style.other[1], Layer::default());
        assert_eq!(style.tiled, Shadow::default());
        assert!(style.edge.shows());
        assert!(!style.edge_filled);
        assert!(!style.ring.shows());
        assert_eq!(style.fade, Duration::from_millis(150));
    }

    #[test]
    fn nothing_is_nothing() {
        let style = parse(json!({})).expect("an empty style");
        assert_eq!(
            style,
            Style {
                edge_filled: true,
                ..Style::default()
            }
        );
    }

    #[test]
    fn refuses_what_is_out_of_range() {
        let bad = [
            json!({"shadow": {"focused": [{}, {}, {}]}}),
            json!({"shadow": {"other": [{"alpha": 2}]}}),
            json!({"shadow": {"other": [{"blur": -1}]}}),
            json!({"shadow": []}),
            json!({"edge": {"color": "black", "width": 1}}),
            json!({"edge": {"color": "#000000", "width": 40}}),
            json!({"edge": {"color": "#000000", "width": 1, "filled": "no"}}),
            json!({"ring": {"on": true, "color": "#000000"}}),
            json!({"fade": 5000}),
        ];
        for value in bad {
            assert!(parse(params(value.clone())).is_err(), "{value}");
        }
    }
}
