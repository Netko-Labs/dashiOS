//! The `outputs` answer, in the shape the shell parses (src/displays.ts
//! `parseScreens`, src/display-config/monitors.ts `parseMonitors`).

use serde_json::{Value, json};
use smithay::{
    desktop::layer_map_for_output,
    output::{Output, Scale},
    utils::Transform,
};

use crate::{state::Dashi, wm::rect_json};

/// The transform to report, when it is not the one the output renders with
/// (the nested window draws flipped for GL; to the shell it is upright).
pub(crate) struct ShownTransform(pub Transform);

/// The scales the shell may set: below this text is unreadable, above it nothing fits.
const SCALES: std::ops::RangeInclusive<f64> = 0.5..=4.0;

pub(crate) fn describe_all(state: &Dashi) -> Value {
    let outputs: Vec<Value> = state
        .space
        .outputs()
        .enumerate()
        .map(|(index, output)| describe(state, output, index == 0))
        .collect();
    json!({ "outputs": outputs })
}

fn describe(state: &Dashi, output: &Output, primary: bool) -> Value {
    let properties = output.physical_properties();
    let current = output.current_mode();
    let preferred = output.preferred_mode();
    let modes: Vec<Value> = output
        .modes()
        .iter()
        .map(|mode| {
            json!({
                "width": mode.size.w,
                "height": mode.size.h,
                "refreshMhz": mode.refresh,
                "preferred": Some(*mode) == preferred,
                "current": Some(*mode) == current,
            })
        })
        .collect();
    let transform = output
        .user_data()
        .get::<ShownTransform>()
        .map(|shown| shown.0)
        .unwrap_or_else(|| output.current_transform());
    let (rotation, flipped) = rotation_of(transform);
    let frame = state.space.output_geometry(output);
    let usable = frame.map(|frame| {
        let mut zone = layer_map_for_output(output).non_exclusive_zone();
        zone.loc += frame.loc;
        zone
    });
    json!({
        "name": output.name(),
        "make": properties.make,
        "model": properties.model,
        "serial": "",
        "enabled": true,
        "lit": true,
        "primary": primary,
        "physicalMm": { "width": properties.size.w, "height": properties.size.h },
        "scale": output.current_scale().fractional_scale(),
        "transform": { "rotation": rotation, "flipped": flipped },
        "mode": current.map(|mode| json!({ "width": mode.size.w, "height": mode.size.h, "refreshMhz": mode.refresh })),
        "modes": modes,
        "frame": frame.map(rect_json),
        "usable": usable.map(rect_json),
    })
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
    layer_map_for_output(&output).arrange();
    state.ipc.emit("outputs-changed", json!({}));
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
