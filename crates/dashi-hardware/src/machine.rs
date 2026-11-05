//! The machine: sysfs, the model, the knobs and fans it has, and the saved
//! state, with the operations the service and the CLI share. It enforces
//! ranges (every value is clamped) and knows nothing about policy or D-Bus.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::fans::{self, Fan};
use crate::knobs::{self, Found, Knob, SetError};
use crate::model::{self, Dmi, Model};
use crate::smu;
use crate::state::{SavedTuning, State};
use crate::sysfs::Sysfs;

pub(crate) use crate::knobs::Value as KnobValue;

/// A laptop chassis, by DMI type (docs/0.4.0.html): laptop, notebook,
/// hand-held, sub-notebook, convertible, detachable.
const LAPTOP_CHASSIS: [&str; 6] = ["8", "9", "10", "14", "31", "32"];

pub(crate) struct Machine {
    pub(crate) sysfs: Sysfs,
    model: Option<Model>,
    knobs: Vec<Found>,
    fans: Vec<Fan>,
    state: State,
}

/// The outcome of one request (the CLI prints it; the service maps it to a
/// D-Bus reply or error).
#[derive(Debug)]
pub(crate) enum OpError {
    /// No such knob or fan on this machine.
    NotFound(String),
    /// The value was the wrong type or outside what the knob takes.
    Invalid(String),
    /// A write failed.
    Io(String),
    /// The Curve Optimizer isn't available (the reason string).
    Unavailable(String),
}

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpError::NotFound(s) => write!(f, "{s} is not on this machine"),
            OpError::Invalid(s) => write!(f, "{s}"),
            OpError::Io(s) => write!(f, "{s}"),
            OpError::Unavailable(s) => write!(f, "the Curve Optimizer is unavailable: {s}"),
        }
    }
}

impl Machine {
    pub(crate) fn open(sysfs: Sysfs, models_dir: &std::path::Path) -> Self {
        let dmi = Dmi::read(&sysfs);
        let model = model::find(models_dir, &dmi);
        let knobs = knobs::discover(&sysfs, model.as_ref());
        let fans = fans::discover(&sysfs);
        let state = State::for_sysfs(&sysfs);
        Self {
            sysfs,
            model,
            knobs,
            fans,
            state,
        }
    }

    pub(crate) fn state(&self) -> &State {
        &self.state
    }

    fn knob(&self, name: &str) -> Result<&Found, OpError> {
        self.knobs
            .iter()
            .find(|f| f.knob.name() == name)
            .ok_or_else(|| OpError::NotFound(name.to_owned()))
    }

    fn fan(&self, id: &str) -> Result<&Fan, OpError> {
        self.fans
            .iter()
            .find(|f| f.id == id)
            .ok_or_else(|| OpError::NotFound(format!("fan {id}")))
    }

    /// The polkit action a `Set` of `knob` needs, for the service's check.
    pub(crate) fn action_for(&self, knob: &str) -> Option<knobs::Action> {
        Knob::from_name(knob).map(Knob::action)
    }

    /// Every file the service polls for `Changed` signals, with the knob
    /// each belongs to (`""` for the keyboard's hardware-change marker).
    pub(crate) fn watched_files(&self) -> Vec<(String, &'static str)> {
        self.knobs
            .iter()
            .flat_map(|found| {
                let name = found.knob.name();
                found.watched().into_iter().map(move |file| (file, name))
            })
            .collect()
    }

    pub(crate) fn get(&self, knob: &str) -> Result<KnobValue, OpError> {
        self.knob(knob)?
            .read(&self.sysfs)
            .ok_or_else(|| OpError::Io(format!("couldn't read {knob}")))
    }

    /// Parse `text` for `knob` and set it, clamped; returns what was written.
    pub(crate) fn set_text(&self, knob: &str, text: &str) -> Result<KnobValue, OpError> {
        let kind = Knob::from_name(knob)
            .ok_or_else(|| OpError::NotFound(knob.to_owned()))?
            .kind();
        let value = KnobValue::parse(kind, text).map_err(OpError::Invalid)?;
        self.set(knob, value)
    }

    pub(crate) fn set(&self, knob: &str, value: KnobValue) -> Result<KnobValue, OpError> {
        let found = self.knob(knob)?;
        found.set(&self.sysfs, value).map_err(|e| match e {
            SetError::Invalid(s) => OpError::Invalid(s),
            SetError::Io(e) => OpError::Io(e.to_string()),
        })
    }

    /// `Describe()`'s JSON.
    pub(crate) fn describe(&self) -> Value {
        let mut knobs = Map::new();
        for found in &self.knobs {
            knobs.insert(found.knob.name().to_owned(), found.describe(&self.sysfs));
        }
        let fans: Vec<Value> = self
            .fans
            .iter()
            .map(|fan| fan.describe(&self.sysfs, self.model.as_ref()))
            .collect();
        let dmi = |field: &str| self.sysfs.read(&format!("class/dmi/id/{field}"));
        json!({
            "model": self.model.as_ref().map(|m| m.id.clone()),
            "modelName": self.model.as_ref().map(|m| m.name.clone()),
            "vendor": dmi("sys_vendor"),
            "product": dmi("product_name"),
            "laptop": self.is_laptop(),
            "knobs": Value::Object(knobs),
            "fans": fans,
            "lighting": self.lighting(),
            "hotkeys": self.hotkeys(),
            "quirks": self.model.as_ref().map(|m| m.quirks.clone()).unwrap_or_default(),
            "recipes": self.model.as_ref().and_then(|m| m.recipes.clone()),
        })
    }

    fn is_laptop(&self) -> bool {
        let chassis = self
            .sysfs
            .read("class/dmi/id/chassis_type")
            .is_some_and(|t| LAPTOP_CHASSIS.contains(&t.as_str()));
        let battery = !crate::knobs::batteries_present(&self.sysfs).is_empty();
        chassis && battery
    }

    fn lighting(&self) -> Value {
        let light = self.model.as_ref().and_then(|m| m.lighting.as_ref());
        // The number of brightness steps: the model's figure (white-3 → 3),
        // else the kernel's max_brightness.
        let kernel_max = self
            .knobs
            .iter()
            .find(|f| f.knob == Knob::KbdBacklight)
            .and_then(|f| match &f.spec {
                knobs::Spec::Range { max, .. } => Some(*max),
                _ => None,
            });
        let model_keyboard = light.and_then(|l| l.keyboard.as_ref());
        let model_levels = model_keyboard.and_then(|k| k.levels);
        let rgb = model_keyboard.is_some_and(|k| k.rgb);
        let keyboard = model_levels
            .or(kernel_max)
            .map(|levels| json!({"levels": levels, "rgb": rgb}));
        json!({
            "keyboard": keyboard,
            "slash": light.map(|l| l.slash.is_some()).unwrap_or(false),
            "aura": light.map(|l| l.aura.is_some()).unwrap_or(false),
            "anime": light.map(|l| l.anime.is_some()).unwrap_or(false),
        })
    }

    fn hotkeys(&self) -> Value {
        self.model
            .as_ref()
            .and_then(|m| m.hotkeys.clone())
            .unwrap_or(Value::Null)
    }

    pub(crate) fn fan_curve(&self, id: &str) -> Result<Vec<(u8, u8)>, OpError> {
        self.fan(id)?
            .curve(&self.sysfs)
            .ok_or_else(|| OpError::NotFound(format!("a curve for fan {id}")))
    }

    pub(crate) fn set_fan_curve(&self, id: &str, points: &[(u8, u8)]) -> Result<(), OpError> {
        self.fan(id)?
            .set_curve(&self.sysfs, points)
            .map_err(OpError::Invalid)
    }

    pub(crate) fn reset_fan_curves(&self) -> Result<(), OpError> {
        for fan in &self.fans {
            fan.reset_curve(&self.sysfs)
                .map_err(|e| OpError::Io(e.to_string()))?;
        }
        Ok(())
    }

    // ---- The Curve Optimizer ----

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

    /// Re-apply the saved power limits, GPU limits and Curve Optimizer, but
    /// only after a clean boot (docs/hardware.md). Returns `{applied, reason}`.
    pub(crate) fn apply_saved_tuning(&self) -> Value {
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
