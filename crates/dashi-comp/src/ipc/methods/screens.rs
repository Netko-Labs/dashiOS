//! Screens, GPUs, and the wallpaper (docs/compositor-ipc.md, "Screens").

use serde_json::{Value, json};

use super::{Ask, done};
use crate::{
    backend,
    ipc::params::{flag, number, on, text},
    outputs,
    state::Dashi,
};

pub(crate) fn outputs(state: &mut Dashi, _: &Ask) -> Result<Value, String> {
    Ok(outputs::describe_all(state))
}

pub(crate) fn mirror(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_mirror(&ask.params))
}

pub(crate) fn output(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let name = text(&ask.params, "name")?.to_owned();
    done(outputs::set_scale(
        state,
        &name,
        number(&ask.params, "scale")?,
    ))
}

pub(crate) fn outputs_config(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.configure_outputs(&ask.params))
}

pub(crate) fn xwayland_scale(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_xwayland_scale(number(&ask.params, "scale")?))
}

pub(crate) fn cursor_size(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let size = number(&ask.params, "size")?;
    if !(16.0..=128.0).contains(&size) || size.fract() != 0.0 {
        return Err("cursor-size: `size` must be a whole number from 16 to 128".into());
    }
    state.cursors.set_size(size as u32);
    Ok(json!({}))
}

pub(crate) fn input_region(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    done(state.set_layer_region(&ask.params))
}

pub(crate) fn power(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let params = &ask.params;
    let on = on(params, "on")?;
    let only = match params.get("output") {
        None | Some(Value::Null) => None,
        Some(_) => Some(text(params, "output")?),
    };
    backend::udev::power(state, on, flag(params, "reset"), only)?;
    Ok(json!({}))
}

pub(crate) fn gamma(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let channel = |key: &str| number(&ask.params, key).map(|v| v.clamp(0.1, 1.0));
    let tint = [channel("red")?, channel("green")?, channel("blue")?];
    let neutral = tint.iter().all(|c| *c >= 0.999);
    state.backend.set_gamma((!neutral).then_some(tint));
    Ok(json!({}))
}

pub(crate) fn gpus(state: &mut Dashi, _: &Ask) -> Result<Value, String> {
    Ok(backend::udev::describe_gpus(state))
}

pub(crate) fn gpu_keep(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    let on = on(&ask.params, "on")?;
    done(backend::udev::keep_gpu(
        state,
        text(&ask.params, "card")?,
        on,
    ))
}

pub(crate) fn wallpaper(state: &mut Dashi, ask: &Ask) -> Result<Value, String> {
    state.set_wallpaper(&ask.params)
}
