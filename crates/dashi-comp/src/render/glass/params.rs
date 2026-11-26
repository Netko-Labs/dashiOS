//! `glass`'s params, as the shell sends them (docs/compositor-ipc.md): the
//! panes of one of its layer surfaces that are frosted glass, each with its
//! whole look. Every number is the shell's (TypeScript decides); the
//! compositor only range-checks them, and a bad one changes nothing.

use serde::{Deserialize, Serialize};
use smithay::utils::{Logical, Rectangle};

use super::style::{Level, Look};
use crate::{handlers::layer_regions::RegionRect, ipc::protocol::Real, render::depth::style::hex};

/// More panes than any surface of the shell's needs.
pub(super) const MOST: usize = 8;

/// `glass {namespace, panes}`: `[]` frosts nothing on that surface again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GlassParams {
    pub namespace: String,
    pub panes: Vec<PaneParams>,
}

/// One pane: where (surface coordinates; none is the whole surface), its corner radius, and
/// either its material `level` (its look from `glass-style`) or, the spike's way, how thick the
/// glass is (`blur`, logical pixels, about CSS's `backdrop-filter: blur()`), how much
/// it lifts the colours behind (`saturation`, 1 none), a `tint` laid over (`#rrggbbaa`) and
/// grain (`noise`, 0 to 1 of a step either way); with `xray`, only the wallpaper shows through.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PaneParams {
    pub rect: Option<RegionRect>,
    pub radius: Real<0, 128_000>,
    pub level: Option<Level>,
    pub blur: Option<Real<0, 128_000>>,
    pub saturation: Option<Real<0, 3_000>>,
    pub tint: Option<String>,
    pub noise: Option<Real<0, 1_000>>,
    /// Only the wallpaper shows through, blurred (no windows): blurred once, then kept.
    pub xray: Option<bool>,
    /// Multiplies the blurred colours' brightness (1 none).
    pub brightness: Option<Real<0, 3_000>>,
    /// The tint is raised where it must be (never lowered) for words of this colour to keep this
    /// contrast ratio over the blurred backdrop, pixel by pixel.
    pub floor: Option<FloorParams>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct FloorParams {
    pub ink: String,
    pub ratio: Real<1_000, 21_000>,
}

/// The reply: whether this compositor frosts at all (false nested, headless, or where its
/// shaders did not compile): the shell keeps its glass opaque then.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GlassReply {
    pub frosted: bool,
}

/// A pane as the compositor keeps it: its own look, or its level's (with its radius).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Pane {
    /// In surface coordinates; none: the whole surface.
    pub rect: Option<Rectangle<f64, Logical>>,
    pub look: Look,
    pub level: Option<Level>,
}

/// The panes `params` names, or why not.
pub(super) fn parse(params: &GlassParams) -> Result<Vec<Pane>, String> {
    let namespace = params.namespace.as_str();
    if !namespace.starts_with("dashi.") || namespace.len() > 64 {
        return Err("glass: `namespace` must be one of the shell's (dashi.*)".into());
    }
    if params.panes.len() > MOST {
        return Err(format!("glass: at most {MOST} panes"));
    }
    params.panes.iter().map(pane).collect()
}

fn pane(params: &PaneParams) -> Result<Pane, String> {
    let rect = params.rect.map(|rect| {
        Rectangle::new(
            (rect.x.get(), rect.y.get()).into(),
            (rect.width.get().max(0.0), rect.height.get().max(0.0)).into(),
        )
    });
    let blur = match (params.level, params.blur) {
        (_, Some(blur)) => blur.get(),
        (Some(_), None) => 0.0,
        (None, None) => return Err("glass: a pane needs a `level` or a `blur`".into()),
    };
    let tint = match params.tint.as_deref() {
        None => [0.0; 4],
        Some(text) => {
            let [r, g, b, a] = hex(text).ok_or("glass: `tint` must be #rrggbb or #rrggbbaa")?;
            [r * a, g * a, b * a, a]
        }
    };
    Ok(Pane {
        rect,
        level: params.level,
        look: Look {
            saturation: params.saturation.map_or(1.0, |s| s.get() as f32),
            tint,
            noise: params.noise.map_or(0.0, |n| n.get() as f32),
            xray: params.xray.unwrap_or(false),
            brightness: params.brightness.map_or(1.0, |b| b.get() as f32),
            floor: match &params.floor {
                None => [0.0; 2],
                Some(f) => floor(f)?,
            },
            ..Look::plain(params.radius.get(), blur)
        },
    })
}

/// A floor as the shader takes it: the ink's luminance and the ratio.
pub(super) fn floor(params: &FloorParams) -> Result<[f32; 2], String> {
    let ink = hex(&params.ink).ok_or("glass: `floor.ink` must be #rrggbb")?;
    Ok([luminance(ink), params.ratio.get() as f32])
}

/// WCAG's relative luminance of a straight sRGB colour.
fn luminance([r, g, b, _]: [f32; 4]) -> f32 {
    let linear = |c: f32| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::ipc::protocol::read;

    fn parsed(value: serde_json::Value) -> Result<Vec<Pane>, String> {
        parse(&read::<GlassParams>(value)?)
    }

    #[test]
    fn a_pane_takes_the_shells_look() {
        let panes = parsed(json!({ "namespace": "dashi.launcher", "panes": [
            { "rect": { "x": 0, "y": 0, "width": 680, "height": 400 }, "radius": 16, "blur": 30,
              "saturation": 1.6, "tint": "#ffffff80", "noise": 0.02 }
        ] }))
        .unwrap();
        let look = panes[0].look;
        assert_eq!(look.radius, 16.0);
        assert_eq!(look.blur, 30.0);
        assert!((look.saturation - 1.6).abs() < 1e-6);
        // Premultiplied: half-white is half everything.
        assert!((look.tint[0] - 0.5).abs() < 0.01 && (look.tint[3] - 0.5).abs() < 0.01);
        assert_eq!(panes[0].rect.unwrap().size.w, 680.0);
    }

    #[test]
    fn the_defaults_are_plain_glass_over_the_whole_surface() {
        let panes =
            parsed(json!({ "namespace": "dashi.menubar", "panes": [{ "radius": 0, "blur": 20 }] }))
                .unwrap();
        assert_eq!(panes[0].rect, None);
        assert_eq!(panes[0].look.saturation, 1.0);
        assert_eq!(panes[0].look.tint, [0.0; 4]);
        assert_eq!(panes[0].look.noise, 0.0);
        assert_eq!(panes[0].look.brightness, 1.0);
        assert_eq!(panes[0].look.floor, [0.0; 2]);
    }

    #[test]
    fn a_floor_keeps_its_words_luminance() {
        let pane = |ink: &str| {
            parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": 0, "blur": 9, "floor": { "ink": ink, "ratio": 4.5 } }] }))
                .map(|panes| panes[0].look.floor)
        };
        assert_eq!(pane("#000000").unwrap(), [0.0, 4.5]);
        assert!((pane("#ffffff").unwrap()[0] - 1.0).abs() < 1e-4);
        assert!((pane("#777777").unwrap()[0] - 0.184).abs() < 0.002);
        assert!(pane("ink").is_err());
    }

    #[test]
    fn a_pane_may_name_its_level_instead() {
        let panes = parsed(
            json!({ "namespace": "dashi.dock", "panes": [{ "radius": 20, "level": "thin" }] }),
        )
        .unwrap();
        assert_eq!(panes[0].level, Some(Level::Thin));
        assert_eq!(panes[0].look.radius, 20.0);
    }

    #[test]
    fn bad_params_change_nothing() {
        assert!(parsed(json!({ "namespace": "firefox", "panes": [] })).is_err());
        assert!(
            parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": -1, "blur": 2 }] }))
                .is_err()
        );
        assert!(parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": 1 }] })).is_err());
        assert!(
            parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": 1, "blur": 200 }] }))
                .is_err()
        );
        assert!(parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": 1, "blur": 2, "tint": "red" }] })).is_err());
        assert!(parsed(json!({ "namespace": "dashi.x", "panes": [{ "radius": 1, "blur": 2, "saturation": 9 }] })).is_err());
        let many = vec![json!({ "radius": 0, "blur": 1 }); MOST + 1];
        assert!(parsed(json!({ "namespace": "dashi.x", "panes": many })).is_err());
    }
}
