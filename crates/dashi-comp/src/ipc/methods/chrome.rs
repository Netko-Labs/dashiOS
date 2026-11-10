//! The shell's chrome, its input claims, and its settings (docs/compositor-ipc.md,
//! "Shell chrome and input claims").

use serde_json::{Value, json};

use super::{Ask, done};
use crate::{ipc::params::coord, keys::Keymap, render, state::Dashi};

pub(crate) fn chrome(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
    if let Some(dark) = params.get("dark") {
        state.chrome_style.dark = dark.as_bool().ok_or("`dark` must be true or false")?;
    }
    if params.contains_key("radius") {
        state.chrome_style.radius = coord(params, "radius")?.clamp(0, 32);
    }
    if let Some(reduce) = params.get("reduceMotion") {
        state.chrome_style.reduce_motion = reduce
            .as_bool()
            .ok_or("`reduceMotion` must be true or false")?;
    }
    Ok(json!({}))
}

pub(crate) fn window_style(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.window_style = render::depth::style::parse(&ask.params)?;
    Ok(json!({}))
}

pub(crate) fn keymap(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.keys.keymap = Keymap::parse(&ask.params)?;
    Ok(json!({}))
}

pub(crate) fn bars(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
    let top = params
        .contains_key("top")
        .then(|| coord(params, "top"))
        .transpose()?;
    let show = match params.get("show") {
        None => None,
        Some(show) => {
            let show = show.as_bool().ok_or("`show` must be true or false")?;
            let output = params
                .get("output")
                .and_then(Value::as_str)
                .map(str::to_owned);
            Some((show, output))
        }
    };
    state.set_bars(top, show);
    Ok(json!({}))
}

pub(crate) fn edges(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let band = coord(&ask.params, "bottom")?;
    let output = ask
        .params
        .get("output")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(json!({ "inside": state.claim_bottom(band, output) }))
}

pub(crate) fn layout(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_zones(&ask.params))
}

pub(crate) fn gestures(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let swipe = ask
        .params
        .get("swipe")
        .and_then(Value::as_array)
        .ok_or("`swipe` must be a list of finger counts")?;
    state.claim_swipes(
        swipe
            .iter()
            .filter_map(Value::as_u64)
            .map(|f| f as u32)
            .collect(),
    );
    Ok(json!({}))
}

pub(crate) fn idle(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let timeouts = ask
        .params
        .get("timeouts")
        .and_then(Value::as_array)
        .ok_or("`timeouts` must be a list of seconds")?;
    let timeouts = timeouts
        .iter()
        .map(|t| t.as_u64().ok_or("`timeouts` must be a list of seconds"))
        .collect::<Result<_, _>>()?;
    state.set_idle_timeouts(timeouts);
    Ok(json!({}))
}

pub(crate) fn keyboard(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_keyboard(&ask.params))
}

pub(crate) fn input(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_input(&ask.params))
}
