//! `glass-style`: how each material level looks and whether glass is frosted,
//! shows only the wallpaper, or is drawn solid (docs/compositor-ipc.md). The
//! shell sends it from `@dashi/ui`'s `theme/glass.ts` for the mode it is in,
//! and again when the mode, Reduce Transparency or battery saver change: every
//! number is the shell's (TypeScript decides); this only range-checks them.

use serde::{Deserialize, Serialize};

use crate::{ipc::protocol::Real, render::depth::style::hex};

/// The material levels (dashi-chrome-v1's `level`, in its order).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Level {
    Thin,
    Regular,
    Thick,
    Paper,
    Veil,
}

impl Level {
    pub(crate) const ALL: [Level; 5] = [
        Level::Thin,
        Level::Regular,
        Level::Thick,
        Level::Paper,
        Level::Veil,
    ];

    /// The protocol's value for it.
    pub(crate) fn from_wire(value: u32) -> Option<Level> {
        Level::ALL.get(value as usize).copied()
    }
}

/// How glass is drawn everywhere: frosted; the wallpaper only, blurred once (battery saver);
/// or each level's solid twin (Reduce Transparency, a frame budget missed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Mode {
    #[default]
    Frosted,
    Xray,
    Solid,
}

/// `glass-style {mode, levels, grain, rim, hairline, floor, depth, apps}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GlassStyleParams {
    pub mode: Mode,
    pub levels: LevelsParams,
    /// The grain: grey ± this (0 to 1).
    pub grain: Real<0, 1_000>,
    pub rim: RimParams,
    pub hairline: HairlineParams,
    /// The tint rises until words of `ink` keep `ratio` over the backdrop, the grain included.
    pub floor: Option<super::params::FloorParams>,
    /// How many glass layers a pane sees under it; a deeper one is its solid twin (GL-2).
    pub depth: Real<1_000, 8_000>,
    /// The level an app's blur region borrows its blur and saturation from (no tint, no rim).
    pub apps: Level,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LevelsParams {
    pub thin: LevelParams,
    pub regular: LevelParams,
    pub thick: LevelParams,
    pub paper: LevelParams,
    pub veil: LevelParams,
}

/// One level: `blur` (points), `saturation` (1 none), the `tint` with its least α
/// (`#rrggbbaa`), its `solid` twin (`#rrggbb`; none: nothing is drawn where glass is solid), and
/// how far (points) the floor looks for the hardest ground (`reach`; none: each pixel its own).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LevelParams {
    pub blur: Real<0, 128_000>,
    pub saturation: Real<0, 3_000>,
    pub tint: String,
    pub solid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reach: Option<Real<0, 512_000>>,
}

/// The rim: a line `width` points inside the edge, from `top` through `middle` to `bottom`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RimParams {
    pub width: Real<0, 4_000>,
    pub top: String,
    pub middle: String,
    pub bottom: String,
}

/// The hairline (Frost's keel): a line `width` points just outside the edge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HairlineParams {
    pub width: Real<0, 4_000>,
    pub color: String,
}

/// How a pane looks, in logical pixels where it measures (the screen's, once placed).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Look {
    pub radius: f64,
    pub blur: f64,
    pub saturation: f32,
    /// Premultiplied RGBA; its α is the least the floor starts from.
    pub tint: [f32; 4],
    pub noise: f32,
    /// Only the wallpaper behind.
    pub xray: bool,
    pub brightness: f32,
    /// The words' relative luminance and the ratio they keep; a ratio of 0 is no floor.
    pub floor: [f32; 2],
    /// How far the floor looks for the hardest ground round each pixel (0: the pixel's own).
    pub reach: f64,
    /// Drawn as this colour instead of frosted (the solid twin).
    pub solid: Option<[f32; 3]>,
    /// The rim's width and its colours, top, middle, bottom (premultiplied).
    pub rim: (f64, [[f32; 4]; 3]),
    /// The hairline's width and colour (premultiplied).
    pub keel: (f64, [f32; 4]),
}

impl Look {
    /// A look with nothing but a blur (the spike's panes start from it).
    pub(crate) fn plain(radius: f64, blur: f64) -> Look {
        Look {
            radius,
            blur,
            saturation: 1.0,
            tint: [0.0; 4],
            noise: 0.0,
            xray: false,
            brightness: 1.0,
            floor: [0.0; 2],
            reach: 0.0,
            solid: None,
            rim: (0.0, [[0.0; 4]; 3]),
            keel: (0.0, [0.0; 4]),
        }
    }

    /// Lengths in the screen's pixels.
    pub(crate) fn scaled(self, scale: f64) -> Look {
        Look {
            radius: self.radius * scale,
            blur: self.blur * scale,
            reach: self.reach * scale,
            rim: (self.rim.0 * scale, self.rim.1),
            keel: (self.keel.0 * scale, self.keel.1),
            ..self
        }
    }

    /// As `mode` draws it: frosted as it is, the wallpaper only, or solid. None: not drawn.
    pub(crate) fn in_mode(self, mode: Mode) -> Option<Look> {
        match mode {
            Mode::Frosted => Some(self),
            Mode::Xray => Some(Look { xray: true, ..self }),
            Mode::Solid => self.solid.is_some().then_some(self),
        }
        .map(|look| Look {
            solid: look.solid.filter(|_| mode == Mode::Solid),
            ..look
        })
    }
}

/// The style as kept: each level's look (radius 0), the mode, the depth, and the apps' level.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Style {
    pub mode: Mode,
    looks: [Look; 5],
    pub depth: usize,
    pub apps: Level,
}

impl Style {
    /// `level`'s look with corners of `radius`, as the mode draws it (none: not drawn).
    pub(crate) fn look(&self, level: Level, radius: f64) -> Option<Look> {
        Look {
            radius,
            ..self.looks[level as usize]
        }
        .in_mode(self.mode)
    }

    /// An app's blur region: the apps' level's blur and saturation, its grain; no tint, rim,
    /// hairline or floor (the app tints itself). Solid: not drawn (the app's own fill shows).
    pub(crate) fn app_look(&self) -> Option<Look> {
        let level = self.looks[self.apps as usize];
        Look {
            noise: level.noise,
            saturation: level.saturation,
            ..Look::plain(0.0, level.blur)
        }
        .in_mode(self.mode)
    }

    /// The level's solid twin, for a pane too deep under glass (GL-2).
    pub(crate) fn solid_twin(look: Look, twin: Option<[f32; 3]>) -> Option<Look> {
        twin.map(|solid| Look {
            solid: Some(solid),
            ..look
        })
    }

    /// Each level's solid colour, whatever the mode.
    pub(crate) fn twin(&self, level: Level) -> Option<[f32; 3]> {
        self.looks[level as usize].solid
    }
}

fn colour(text: &str, what: &str) -> Result<[f32; 4], String> {
    let [r, g, b, a] =
        hex(text).ok_or_else(|| format!("glass-style: `{what}` must be #rrggbb or #rrggbbaa"))?;
    Ok([r * a, g * a, b * a, a])
}

/// The style `params` names, or why not.
pub(crate) fn parse(params: &GlassStyleParams) -> Result<Style, String> {
    let rim = (
        params.rim.width.get(),
        [
            colour(&params.rim.top, "rim.top")?,
            colour(&params.rim.middle, "rim.middle")?,
            colour(&params.rim.bottom, "rim.bottom")?,
        ],
    );
    let keel = (
        params.hairline.width.get(),
        colour(&params.hairline.color, "hairline.color")?,
    );
    let floor = match &params.floor {
        None => [0.0; 2],
        Some(floor) => super::params::floor(floor)?,
    };
    let level = |level: &LevelParams| -> Result<Look, String> {
        let solid = match level.solid.as_deref() {
            None => None,
            Some(text) => {
                let [r, g, b, _] = hex(text).ok_or("glass-style: `solid` must be #rrggbb")?;
                Some([r, g, b])
            }
        };
        Ok(Look {
            saturation: level.saturation.get() as f32,
            tint: colour(&level.tint, "tint")?,
            noise: params.grain.get() as f32,
            floor,
            reach: level.reach.map_or(0.0, |reach| reach.get()),
            solid,
            rim,
            keel,
            ..Look::plain(0.0, level.blur.get())
        })
    };
    let l = &params.levels;
    Ok(Style {
        mode: params.mode,
        looks: [
            level(&l.thin)?,
            level(&l.regular)?,
            level(&l.thick)?,
            level(&l.paper)?,
            level(&l.veil)?,
        ],
        depth: params.depth.get().round() as usize,
        apps: params.apps,
    })
}

#[cfg(test)]
#[path = "style_tests.rs"]
pub(crate) mod tests;
