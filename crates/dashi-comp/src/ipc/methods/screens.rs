//! Screens, GPUs, and the wallpaper (docs/compositor-ipc.md, "Screens").

use serde::{Deserialize, Serialize};

use super::{Ask, done};
use crate::{
    backend,
    handlers::layer_regions::InputRegion,
    ipc::protocol::{Done, Finite, Gpus, Int, Nothing, Outputs, WallpaperParams},
    outputs::{self, MirrorParams, OutputsConfig},
    state::Dashi,
};

/// A screen's scale.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OutputScale {
    pub name: String,
    pub scale: Finite,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Scale {
    pub scale: Finite,
}

/// The pointer's size, a whole number of points from 16 to 128.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CursorSize {
    pub size: Int<16, 128>,
}

/// Screens on or off (DPMS); with `output`, just that one, held so.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Power {
    pub on: bool,
    #[serde(default)]
    pub reset: bool,
    pub output: Option<String>,
}

/// The Night Shift tint: each channel 0.1 to 1 (kept within).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Gamma {
    pub red: Finite,
    pub green: Finite,
    pub blue: Finite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GpuKeep {
    pub card: String,
    pub on: bool,
}

pub(crate) fn outputs(state: &mut Dashi, _: &Ask, _: Nothing) -> Result<Outputs, String> {
    Ok(outputs::describe_all(state))
}

pub(crate) fn mirror(state: &mut Dashi, _: &Ask, params: MirrorParams) -> Result<Done, String> {
    done(state.set_mirror(&params))
}

pub(crate) fn output(state: &mut Dashi, _: &Ask, params: OutputScale) -> Result<Done, String> {
    done(outputs::set_scale(state, &params.name, params.scale.get()))
}

pub(crate) fn outputs_config(
    state: &mut Dashi,
    _: &Ask,
    params: OutputsConfig,
) -> Result<Done, String> {
    done(state.configure_outputs(&params))
}

pub(crate) fn xwayland_scale(state: &mut Dashi, _: &Ask, params: Scale) -> Result<Done, String> {
    done(state.set_xwayland_scale(params.scale.get()))
}

pub(crate) fn cursor_size(state: &mut Dashi, _: &Ask, params: CursorSize) -> Result<Done, String> {
    state.cursors.set_size(params.size.to::<u32>());
    Ok(Done {})
}

pub(crate) fn input_region(
    state: &mut Dashi,
    _: &Ask,
    params: InputRegion,
) -> Result<Done, String> {
    done(state.set_layer_region(&params))
}

pub(crate) fn power(state: &mut Dashi, _: &Ask, params: Power) -> Result<Done, String> {
    backend::udev::power(state, params.on, params.reset, params.output.as_deref())?;
    Ok(Done {})
}

pub(crate) fn gamma(state: &mut Dashi, _: &Ask, params: Gamma) -> Result<Done, String> {
    let channel = |value: Finite| value.get().clamp(0.1, 1.0);
    let tint = [
        channel(params.red),
        channel(params.green),
        channel(params.blue),
    ];
    let neutral = tint.iter().all(|c| *c >= 0.999);
    state.backend.set_gamma((!neutral).then_some(tint));
    Ok(Done {})
}

pub(crate) fn gpus(state: &mut Dashi, _: &Ask, _: Nothing) -> Result<Gpus, String> {
    Ok(backend::udev::describe_gpus(state))
}

pub(crate) fn gpu_keep(state: &mut Dashi, _: &Ask, params: GpuKeep) -> Result<Done, String> {
    done(backend::udev::keep_gpu(state, &params.card, params.on))
}

pub(crate) fn wallpaper(
    state: &mut Dashi,
    _: &Ask,
    params: WallpaperParams,
) -> Result<Done, String> {
    done(state.set_wallpaper(&params))
}
