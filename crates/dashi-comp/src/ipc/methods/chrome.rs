//! The shell's chrome, its input claims, and its settings (docs/compositor-ipc.md,
//! "Shell chrome and input claims").

use serde::{Deserialize, Serialize};

use super::{Ask, done};
use crate::{
    input::{InputParams, Pointers},
    ipc::protocol::{Coord, Count, Done, Int, Millis, Nothing, Rect},
    keys::{HeldKeysParams, KeyboardParams, Keymap, KeymapParams},
    render::{self, depth::WindowStyle},
    state::Dashi,
};

/// The title bar style.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Chrome {
    pub dark: Option<bool>,
    /// Corner radius, 0 to 32 (kept within).
    pub radius: Option<Coord>,
    pub reduce_motion: Option<bool>,
}

/// The top-edge band for full-screen menu bars, and whether they show (on `output`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Bars {
    pub top: Option<Coord>,
    pub show: Option<bool>,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Edges {
    pub bottom: Coord,
    pub output: Option<String>,
}

/// Whether the pointer is inside the bottom band now.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Inside {
    pub inside: bool,
}

/// Drag-to-tile zones: resting `dwellMs` in `area` shows `frame`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Layout {
    pub zones: Vec<Zone>,
    pub dwell_ms: Option<Count>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Zone {
    pub area: Rect,
    pub frame: Rect,
}

/// The finger counts the shell claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Gestures {
    pub swipe: Vec<Int<0, 10>>,
}

/// Seconds of no input after which `idle` goes out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Idle {
    pub timeouts: Vec<Millis<{ u32::MAX as i64 }>>,
}

pub(crate) fn chrome(state: &mut Dashi, _: &Ask, params: Chrome) -> Result<Done, String> {
    if let Some(dark) = params.dark {
        state.chrome_style.dark = dark;
    }
    if let Some(radius) = params.radius {
        state.chrome_style.radius = radius.i32().clamp(0, 32);
    }
    if let Some(reduce) = params.reduce_motion {
        state.chrome_style.reduce_motion = reduce;
    }
    Ok(Done {})
}

pub(crate) fn window_style(
    state: &mut Dashi,
    _: &Ask,
    params: WindowStyle,
) -> Result<Done, String> {
    state.window_style = render::depth::style::parse(&params)?;
    Ok(Done {})
}

pub(crate) fn keymap(state: &mut Dashi, _: &Ask, params: KeymapParams) -> Result<Done, String> {
    state.keys.keymap = Keymap::parse(&params)?;
    Ok(Done {})
}

pub(crate) fn held_keys(
    state: &mut Dashi,
    _: &Ask,
    params: HeldKeysParams,
) -> Result<Done, String> {
    done(state.keys.held.set(&params))
}

pub(crate) fn bars(state: &mut Dashi, _: &Ask, params: Bars) -> Result<Done, String> {
    let top = params.top.map(|top| top.i32());
    let show = params.show.map(|show| (show, params.output));
    state.set_bars(top, show);
    Ok(Done {})
}

pub(crate) fn edges(state: &mut Dashi, _: &Ask, params: Edges) -> Result<Inside, String> {
    Ok(Inside {
        inside: state.claim_bottom(params.bottom.i32(), params.output),
    })
}

pub(crate) fn layout(state: &mut Dashi, _: &Ask, params: Layout) -> Result<Done, String> {
    done(state.set_zones(&params))
}

pub(crate) fn gestures(state: &mut Dashi, _: &Ask, params: Gestures) -> Result<Done, String> {
    state.claim_swipes(params.swipe.iter().map(|f| f.to::<u32>()).collect());
    Ok(Done {})
}

pub(crate) fn idle(state: &mut Dashi, _: &Ask, params: Idle) -> Result<Done, String> {
    state.set_idle_timeouts(params.timeouts.iter().map(|t| t.to::<u64>()).collect());
    Ok(Done {})
}

pub(crate) fn keyboard(state: &mut Dashi, _: &Ask, params: KeyboardParams) -> Result<Done, String> {
    done(state.set_keyboard(&params))
}

pub(crate) fn input(state: &mut Dashi, _: &Ask, params: InputParams) -> Result<Done, String> {
    done(state.set_input(&params))
}

pub(crate) fn pointers(state: &mut Dashi, _: &Ask, _: Nothing) -> Result<Pointers, String> {
    Ok(state.pointers())
}
