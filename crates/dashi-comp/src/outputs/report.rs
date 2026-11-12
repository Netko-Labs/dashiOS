//! The `outputs` answer, in the shape the shell parses (src/displays.ts
//! `parseScreens`, src/display-config/monitors.ts `parseMonitors`).

use smithay::{
    desktop::layer_map_for_output,
    output::{Output, Scale},
    utils::Transform,
};

use crate::{
    ipc::protocol::{
        Event, Extent, Frame, Mode, ModeInfo, Output as Screen, Outputs, Rotation, Vrr,
    },
    state::Dashi,
};

/// The transform to report, when it is not the one the output renders with
/// (the nested window draws flipped for GL; to the shell it is upright).
pub(crate) struct ShownTransform(pub Transform);

/// The scales the shell may set: below this text is unreadable, above it nothing fits.
const SCALES: std::ops::RangeInclusive<f64> = 0.5..=4.0;

pub(crate) fn describe_all(state: &Dashi) -> Outputs {
    let first = state.space.outputs().next().map(Output::name);
    let primary = state
        .primary_output
        .clone()
        .filter(|name| state.space.outputs().any(|o| &o.name() == name))
        .or(first);
    let outputs = state
        .all_outputs()
        .iter()
        .map(|output| {
            describe(
                state,
                output,
                primary.as_deref() == Some(output.name().as_str()),
            )
        })
        .collect();
    Outputs { outputs }
}

fn describe(state: &Dashi, output: &Output, primary: bool) -> Screen {
    let properties = output.physical_properties();
    let current = output.current_mode();
    let preferred = output.preferred_mode();
    let modes = output
        .modes()
        .iter()
        .map(|mode| ModeInfo {
            width: mode.size.w,
            height: mode.size.h,
            refresh_mhz: mode.refresh,
            preferred: Some(*mode) == preferred,
            current: Some(*mode) == current,
        })
        .collect();
    let transform = output
        .user_data()
        .get::<ShownTransform>()
        .map(|shown| shown.0)
        .unwrap_or_else(|| output.current_transform());
    let (rotation, flipped) = rotation_of(transform);
    let frame = state.space.output_geometry(output);
    let mirror_of = state.mirrors.source_of(output).map(str::to_owned);
    let vrr = state.backend.vrr_report(output);
    let usable = frame.map(|frame| {
        let mut zone = layer_map_for_output(output).non_exclusive_zone();
        zone.loc += frame.loc;
        zone
    });
    Screen {
        name: output.name(),
        make: properties.make,
        model: properties.model,
        serial: output
            .user_data()
            .get::<crate::backend::udev::Serial>()
            .map(|s| s.0.clone())
            .unwrap_or_default(),
        enabled: frame.is_some() || mirror_of.is_some(),
        lit: frame.is_some() || mirror_of.is_some(),
        mirror_of,
        primary,
        physical_mm: Extent {
            width: properties.size.w,
            height: properties.size.h,
        },
        scale: state.mirrors.of(output).map_or_else(
            || output.current_scale().fractional_scale(),
            |m| m.own_scale(),
        ),
        transform: Rotation { rotation, flipped },
        mode: current.map(|mode| Mode {
            width: mode.size.w,
            height: mode.size.h,
            refresh_mhz: mode.refresh,
        }),
        modes,
        frame: frame.map(Frame::from),
        usable: usable.map(Frame::from),
        vrr: Vrr {
            supported: vrr.as_ref().is_some_and(|v| v.supported),
            active: vrr.as_ref().is_some_and(|v| v.active),
            mode: state.vrr_mode(output),
        },
    }
}

fn rotation_of(transform: Transform) -> (u32, bool) {
    match transform {
        Transform::Normal => (0, false),
        Transform::_90 => (90, false),
        Transform::_180 => (180, false),
        Transform::_270 => (270, false),
        Transform::Flipped => (0, true),
        Transform::Flipped90 => (90, true),
        Transform::Flipped180 => (180, true),
        Transform::Flipped270 => (270, true),
    }
}

impl Dashi {
    /// A screen's size or scale changed: lay its layers out again and tell the shell.
    pub(crate) fn output_changed(&mut self, output: &Output) {
        layer_map_for_output(output).arrange();
        self.ipc.emit(Event::OutputsChanged);
    }
}

/// `output {name, scale}`.
pub(crate) fn set_scale(state: &mut Dashi, name: &str, scale: f64) -> Result<(), String> {
    if !scale.is_finite() || !SCALES.contains(&scale) {
        return Err(format!(
            "scale {scale} is outside {}–{}",
            SCALES.start(),
            SCALES.end()
        ));
    }
    let output = state
        .space
        .outputs()
        .find(|output| output.name() == name)
        .cloned()
        .ok_or_else(|| format!("no screen named {name:?}"))?;
    output.change_current_state(None, None, Some(Scale::Fractional(scale)), None);
    state.output_changed(&output);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transforms_read_as_a_person_turns_a_screen() {
        assert_eq!(rotation_of(Transform::Normal), (0, false));
        assert_eq!(rotation_of(Transform::_270), (270, false));
        assert_eq!(rotation_of(Transform::Flipped90), (90, true));
    }
}
