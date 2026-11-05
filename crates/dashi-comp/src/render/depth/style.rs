//! `window-style`: the look of the depth between windows, as the shell sends
//! it (docs/compositor-ipc.md). Every value is the shell's; until it sends
//! one, windows have no shadow, edge, or ring. Params are untrusted: each is
//! range-checked, and a bad one changes nothing.

use std::time::Duration;

use serde_json::{Map, Value};

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

const MOST_OFFSET: f64 = 128.0;
const MOST_BLUR: f64 = 128.0;
const MOST_LINE: f64 = 8.0;
const MOST_FADE_MS: u64 = 1000;

/// Parse a whole `window-style` request: keys left out are none.
pub(crate) fn parse(params: &Map<String, Value>) -> Result<Style, String> {
    let shadows = match params.get("shadow") {
        None | Some(Value::Null) => Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => return Err("`shadow` must be an object".into()),
    };
    let shadow = |key: &str| -> Result<Shadow, String> {
        shadow(shadows.get(key)).map_err(|error| format!("shadow.{key}: {error}"))
    };
    let fade = match params.get("fade") {
        None | Some(Value::Null) => 0,
        Some(value) => value
            .as_u64()
            .filter(|ms| *ms <= MOST_FADE_MS)
            .ok_or(format!("`fade` must be 0 to {MOST_FADE_MS} ms"))?,
    };
    Ok(Style {
        focused: shadow("focused")?,
        other: shadow("other")?,
        tiled: shadow("tiled")?,
        filled: shadow("filled")?,
        sheet: shadow("sheet")?,
        edge: line(params.get("edge")).map_err(|error| format!("edge: {error}"))?,
        edge_filled: match params.get("edge").and_then(|edge| edge.get("filled")) {
            None | Some(Value::Null) => true,
            Some(filled) => filled
                .as_bool()
                .ok_or("`edge.filled` must be true or false")?,
        },
        ring: line(params.get("ring")).map_err(|error| format!("ring: {error}"))?,
        fade: Duration::from_millis(fade),
    })
}

fn shadow(value: Option<&Value>) -> Result<Shadow, String> {
    let layers = match value {
        None | Some(Value::Null) => return Ok(Shadow::default()),
        Some(Value::Array(layers)) if layers.len() <= 2 => layers,
        Some(_) => return Err("must be a list of up to two layers".into()),
    };
    let mut shadow = Shadow::default();
    for (slot, layer) in shadow.iter_mut().zip(layers) {
        let layer = layer.as_object().ok_or("each layer is an object")?;
        let get = |key: &str, low: f64, high: f64| -> Result<f64, String> {
            match layer.get(key) {
                None => Ok(0.0),
                Some(value) => value
                    .as_f64()
                    .filter(|v| (low..=high).contains(v))
                    .ok_or(format!("`{key}` must be a number from {low} to {high}")),
            }
        };
        *slot = Layer {
            x: get("x", -MOST_OFFSET, MOST_OFFSET)?,
            y: get("y", -MOST_OFFSET, MOST_OFFSET)?,
            blur: get("blur", 0.0, MOST_BLUR)?,
            spread: get("spread", -MOST_OFFSET, MOST_OFFSET)?,
            alpha: get("alpha", 0.0, 1.0)?,
        };
    }
    Ok(shadow)
}

fn line(value: Option<&Value>) -> Result<Line, String> {
    let line = match value {
        None | Some(Value::Null) => return Ok(Line::default()),
        Some(Value::Object(line)) => line,
        Some(_) => return Err("must be an object".into()),
    };
    if line.get("on").is_some_and(|on| on.as_bool() == Some(false)) {
        return Ok(Line::default());
    }
    let color = line
        .get("color")
        .and_then(Value::as_str)
        .and_then(hex)
        .ok_or("`color` must be #rrggbb or #rrggbbaa")?;
    let width = line
        .get("width")
        .and_then(Value::as_f64)
        .filter(|w| (0.0..=MOST_LINE).contains(w))
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
    use serde_json::json;

    fn params(value: Value) -> Map<String, Value> {
        value.as_object().cloned().unwrap_or_default()
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
        let style = parse(&params(json!({
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
        let style = parse(&Map::new()).expect("an empty style");
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
            assert!(parse(&params(value.clone())).is_err(), "{value}");
        }
    }
}
