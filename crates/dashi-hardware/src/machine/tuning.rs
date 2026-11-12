//! The Curve Optimizer and the saved tuning: applying offsets now, the boot
//! guard, and what `ConfirmTuning` saves.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::{KnobValue, Machine, OpError};
use crate::knobs::{self, Knob};
use crate::smu;
use crate::state::SavedTuning;

impl Machine {
    pub(crate) fn curve_optimizer_json(&self, tuning: &SavedTuning) -> Value {
        let per_core: Vec<i32> = core_vector(tuning, smu::core_count(&self.sysfs));
        smu::describe(
            &self.sysfs,
            self.model.as_ref(),
            tuning.curve_all_core.unwrap_or(0),
            &per_core,
        )
    }

    /// Apply a Curve Optimizer offset now (does not save).
    pub(crate) fn apply_curve_optimizer(
        &self,
        all_core: i32,
        per_core: &[(u32, i32)],
    ) -> Result<(), OpError> {
        let (mut co, cap) = smu::CurveOptimizer::probe(
            &self.sysfs,
            self.model.as_ref(),
            smu::make_smn(&self.sysfs),
        )
        .map_err(|r| OpError::Unavailable(r.reason().to_owned()))?;
        let in_range = |v: i32| (cap.range.0..=cap.range.1).contains(&v);
        if per_core.is_empty() {
            if !in_range(all_core) {
                return Err(OpError::Invalid(format!(
                    "{all_core} is outside {}..{}",
                    cap.range.0, cap.range.1
                )));
            }
            co.set_all_core(all_core).map_err(OpError::Io)
        } else {
            if !cap.per_core {
                return Err(OpError::Invalid("this chip has no per-core offsets".into()));
            }
            for (core, offset) in per_core {
                if !in_range(*offset) {
                    return Err(OpError::Invalid(format!(
                        "core {core}: {offset} is outside {}..{}",
                        cap.range.0, cap.range.1
                    )));
                }
                co.set_per_core(*core, *offset).map_err(OpError::Io)?;
            }
            Ok(())
        }
    }

    // ---- Saved tuning and the boot guard ----

    /// Re-apply the saved Slash settings (always: they are lights), and the
    /// saved power limits, GPU limits and Curve Optimizer only after a clean
    /// boot (docs/hardware.md). Returns `{applied, reason, slash}`.
    pub(crate) fn apply_saved_tuning(&self) -> Value {
        let slash = self.restore_slash();
        let mut result = self.apply_saved_limits();
        if let Value::Object(map) = &mut result {
            map.insert("slash".into(), json!(slash));
        }
        result
    }

    fn apply_saved_limits(&self) -> Value {
        let tuning = self.state.saved_tuning();
        if tuning.is_empty() {
            return json!({"applied": false, "reason": "nothing-saved"});
        }
        if !self.state.last_boot().clean_boot {
            return json!({"applied": false, "reason": "unclean-boot"});
        }
        let mut applied = Vec::new();
        for (name, value) in &tuning.knobs {
            if let Ok(found) = self.knob(name)
                && let Some(parsed) = KnobValue::from_json(found.knob.kind(), value)
                && found.set(&self.sysfs, parsed).is_ok()
            {
                applied.push(name.clone());
            }
        }
        let per_core: Vec<(u32, i32)> = tuning
            .curve_per_core
            .iter()
            .map(|(core, offset)| (*core, *offset))
            .collect();
        let co_ok = if tuning.curve_all_core.is_some() || !per_core.is_empty() {
            self.apply_curve_optimizer(tuning.curve_all_core.unwrap_or(0), &per_core)
                .is_ok()
        } else {
            true
        };
        json!({"applied": true, "reason": "", "knobs": applied, "curveOptimizer": co_ok})
    }

    /// `BootGuard()`: the last boot's record (the boot/clean units set it).
    pub(crate) fn boot_guard(&self) -> Value {
        let guard = self.state.last_boot();
        json!({"cleanBoot": guard.clean_boot, "failedBoots": guard.failed_boots, "reset": guard.reset})
    }

    /// Build a `SavedTuning` from the current values of the tunable knobs and
    /// the given Curve Optimizer offsets, for `ConfirmTuning` to save.
    pub(crate) fn tuning_snapshot(
        &self,
        all_core: Option<i32>,
        per_core: &[(u32, i32)],
    ) -> SavedTuning {
        let mut knobs = BTreeMap::new();
        for found in &self.knobs {
            if found.knob.action() == knobs::Action::Tune
                && found.knob != Knob::GpuMux
                && let Some(value) = found.read(&self.sysfs)
            {
                knobs.insert(found.knob.name().to_owned(), value.json());
            }
        }
        SavedTuning {
            knobs,
            curve_all_core: all_core,
            curve_per_core: per_core.iter().copied().collect(),
        }
    }
}

fn core_vector(tuning: &SavedTuning, cores: u32) -> Vec<i32> {
    if tuning.curve_per_core.is_empty() {
        return Vec::new();
    }
    (0..cores)
        .map(|core| tuning.curve_per_core.get(&core).copied().unwrap_or(0))
        .collect()
}
