//! `outputs-config`: a whole arrangement of screens from System Settings'
//! Displays pane (packages/shell/src/display-config/): on or off, where each
//! is, its mode, rotation, and scale, and which is primary. Every entry is
//! checked before anything changes; the shell reverts on its own timer when
//! the person does not keep it.

use serde_json::{Map, Value};
use smithay::{
    output::{Mode, Output, Scale},
    utils::{Logical, Point, Transform},
};

use crate::state::Dashi;

struct Change {
    output: Output,
    enabled: Option<bool>,
    position: Option<Point<i32, Logical>>,
    mode: Option<Mode>,
    transform: Option<Transform>,
    scale: Option<f64>,
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

impl Dashi {
    /// Every screen the compositor knows, shown or turned off.
    pub(crate) fn all_outputs(&self) -> Vec<Output> {
        self.space
            .outputs()
            .cloned()
            .chain(self.disabled_outputs.iter().cloned())
            .collect()
    }

    pub(crate) fn configure_outputs(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        let entries = params
            .get("outputs")
            .and_then(Value::as_array)
            .ok_or("`outputs` must be a list")?;
        let known = self.all_outputs();
        let mut changes = Vec::new();
        for entry in entries {
            let entry = entry.as_object().ok_or("each output is an object")?;
            let name = entry
                .get("name")
                .and_then(Value::as_str)
                .ok_or("each output needs a name")?;
            let output = known
                .iter()
                .find(|o| o.name() == name)
                .cloned()
                .ok_or_else(|| format!("no screen named {name:?}"))?;
            let enabled = match entry.get("enabled") {
                None => None,
                Some(v) => Some(v.as_bool().ok_or("`enabled` must be true or false")?),
            };
            let position = match entry.get("position") {
                None => None,
                Some(p) => {
                    let x = p
                        .get("x")
                        .and_then(Value::as_i64)
                        .ok_or("`position` needs x and y")?;
                    let y = p
                        .get("y")
                        .and_then(Value::as_i64)
                        .ok_or("`position` needs x and y")?;
                    if x.abs() > 1 << 16 || y.abs() > 1 << 16 {
                        return Err("`position` is out of range".into());
                    }
                    Some(Point::from((x as i32, y as i32)))
                }
            };
            let mode = match entry.get("mode") {
                None => None,
                Some(m) => {
                    let get = |k: &str| m.get(k).and_then(Value::as_i64);
                    let (w, h, refresh) = (get("width"), get("height"), get("refreshMhz"));
                    let found = output.modes().into_iter().find(|mode| {
                        Some(i64::from(mode.size.w)) == w
                            && Some(i64::from(mode.size.h)) == h
                            && Some(i64::from(mode.refresh)) == refresh
                    });
                    Some(found.ok_or_else(|| format!("{name} has no such mode"))?)
                }
            };
            let transform = match entry.get("transform") {
                None => None,
                Some(t) => {
                    let rotation = t.get("rotation").and_then(Value::as_u64).unwrap_or(0);
                    let flipped = t.get("flipped").and_then(Value::as_bool).unwrap_or(false);
                    Some(
                        transform_for(rotation, flipped)
                            .ok_or("`rotation` must be 0, 90, 180, or 270")?,
                    )
                }
            };
            let scale = match entry.get("scale") {
                None => None,
                Some(s) => Some(
                    s.as_f64()
                        .filter(|s| (0.5..=4.0).contains(s))
                        .ok_or("`scale` must be 0.5–4")?,
                ),
            };
            changes.push(Change {
                output,
                enabled,
                position,
                mode,
                transform,
                scale,
            });
        }
        let primary = match params.get("primary") {
            None => None,
            Some(p) => {
                let name = p.as_str().ok_or("`primary` must be a screen's name")?;
                if !known.iter().any(|o| o.name() == name) {
                    return Err(format!("no screen named {name:?}"));
                }
                Some(name.to_owned())
            }
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
        self.ipc.emit("outputs-changed", serde_json::json!({}));
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
        } = change;
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
