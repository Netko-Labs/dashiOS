//! `outputs-config`: a whole arrangement of screens from System Settings'
//! Displays pane (packages/shell/src/display-config/): on or off, where each
//! is, its mode, rotation, and scale, and which is primary. Every entry is
//! checked before anything changes; the shell reverts on its own timer when
//! the person does not keep it.

use serde::{Deserialize, Serialize};
use smithay::{
    output::{Mode, Output, Scale},
    utils::{Logical, Point, Transform},
};

use super::VrrMode;
use crate::{
    ipc::protocol::{Event, Int, Real},
    state::Dashi,
};

struct Change {
    output: Output,
    enabled: Option<bool>,
    position: Option<Point<i32, Logical>>,
    mode: Option<Mode>,
    transform: Option<Transform>,
    scale: Option<f64>,
    vrr: Option<VrrMode>,
}

fn transform_for(rotation: u64, flipped: bool) -> Option<Transform> {
    Some(match (rotation, flipped) {
        (0, false) => Transform::Normal,
        (90, false) => Transform::_90,
        (180, false) => Transform::_180,
        (270, false) => Transform::_270,
        (0, true) => Transform::Flipped,
        (90, true) => Transform::Flipped90,
        (180, true) => Transform::Flipped180,
        (270, true) => Transform::Flipped270,
        _ => return None,
    })
}

/// `outputs-config`'s params: a whole arrangement (the shell's
/// src/display-config/plan.ts `toWire`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OutputsConfig {
    pub outputs: Vec<OutputConfig>,
    pub primary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OutputConfig {
    pub name: String,
    pub enabled: Option<bool>,
    pub position: Option<Position>,
    pub mode: Option<ModeChoice>,
    pub transform: Option<TransformChoice>,
    pub scale: Option<Real<500, 4000>>,
    pub vrr: Option<VrrMode>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Position {
    pub x: Int<{ -(1 << 16) }, { 1 << 16 }>,
    pub y: Int<{ -(1 << 16) }, { 1 << 16 }>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ModeChoice {
    pub width: i64,
    pub height: i64,
    pub refresh_mhz: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TransformChoice {
    #[serde(default)]
    pub rotation: u64,
    #[serde(default)]
    pub flipped: bool,
}

/// One entry, checked against the screens there are.
fn change(known: &[Output], entry: &OutputConfig) -> Result<Change, String> {
    let name = entry.name.as_str();
    let output = known
        .iter()
        .find(|o| o.name() == name)
        .cloned()
        .ok_or_else(|| format!("no screen named {name:?}"))?;
    let mode = match entry.mode {
        None => None,
        Some(m) => Some(
            output
                .modes()
                .into_iter()
                .find(|mode| {
                    i64::from(mode.size.w) == m.width
                        && i64::from(mode.size.h) == m.height
                        && i64::from(mode.refresh) == m.refresh_mhz
                })
                .ok_or_else(|| format!("{name} has no such mode"))?,
        ),
    };
    let transform = match entry.transform {
        None => None,
        Some(t) => Some(
            transform_for(t.rotation, t.flipped).ok_or("`rotation` must be 0, 90, 180, or 270")?,
        ),
    };
    Ok(Change {
        output,
        enabled: entry.enabled,
        position: entry
            .position
            .map(|p| Point::from((p.x.to::<i32>(), p.y.to::<i32>()))),
        mode,
        transform,
        scale: entry.scale.map(Real::get),
        vrr: entry.vrr,
    })
}

impl Dashi {
    /// Every screen the compositor knows, shown or turned off.
    pub(crate) fn all_outputs(&self) -> Vec<Output> {
        self.space
            .outputs()
            .cloned()
            .chain(self.mirrors.targets().cloned())
            .chain(self.disabled_outputs.iter().cloned())
            .collect()
    }

    pub(crate) fn configure_outputs(&mut self, params: &OutputsConfig) -> Result<(), String> {
        let known = self.all_outputs();
        let changes = params
            .outputs
            .iter()
            .map(|entry| change(&known, entry))
            .collect::<Result<Vec<_>, String>>()?;
        let primary = match &params.primary {
            None => None,
            Some(name) if known.iter().any(|o| o.name() == *name) => Some(name.clone()),
            Some(name) => return Err(format!("no screen named {name:?}")),
        };
        if changes.iter().all(|c| c.enabled == Some(false))
            && !changes.is_empty()
            && changes.len() == known.len()
        {
            return Err("at least one screen must stay on".into());
        }

        for change in changes {
            self.apply_output_change(change)?;
        }
        if let Some(primary) = primary {
            self.primary_output = Some(primary);
        }
        for output in self.space.outputs().cloned().collect::<Vec<_>>() {
            smithay::desktop::layer_map_for_output(&output).arrange();
        }
        self.ipc.emit(Event::OutputsChanged);
        Ok(())
    }

    fn apply_output_change(&mut self, change: Change) -> Result<(), String> {
        let Change {
            output,
            enabled,
            position,
            mode,
            transform,
            scale,
            vrr,
        } = change;
        if let Some(vrr) = vrr {
            self.vrr_modes.insert(output.name(), vrr);
        }
        // Turned on or off, or moved, a screen that mirrors shows its own desktop again first.
        if enabled.is_some() || position.is_some() {
            self.unmirror_for_config(&output);
        }
        if let Some(mode) = mode {
            self.backend.set_mode(&output, mode)?;
        }
        output.change_current_state(mode, transform, scale.map(Scale::Fractional), position);
        let shown = self.space.outputs().any(|o| o == &output);
        match enabled {
            Some(false) if shown => {
                self.space.unmap_output(&output);
                self.backend.set_enabled(&output, false);
                self.disabled_outputs.push(output.clone());
            }
            Some(true) if !shown => {
                self.disabled_outputs.retain(|o| o != &output);
                self.backend.set_enabled(&output, true);
                let at = position.unwrap_or_else(|| output.current_location());
                self.space.map_output(&output, at);
            }
            _ if shown => {
                if let Some(at) = position {
                    self.space.map_output(&output, at);
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotations_are_quarter_turns() {
        assert_eq!(transform_for(90, false), Some(Transform::_90));
        assert_eq!(transform_for(180, true), Some(Transform::Flipped180));
        assert_eq!(transform_for(45, false), None);
    }
}
