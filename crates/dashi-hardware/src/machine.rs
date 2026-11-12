//! The machine: sysfs, the model, the knobs and fans it has, and the saved
//! state, with the operations the service and the CLI share. It enforces
//! ranges (every value is clamped) and knows nothing about policy or D-Bus.

mod error;
mod slash;
#[cfg(test)]
mod tests;
mod tuning;

use serde_json::{Map, Value, json};

use crate::fans::{self, Fan};
use crate::knobs::{self, Found, Knob, SetError};
use crate::model::{self, Dmi, Model};
use crate::slash::Bar;
use crate::state::State;
use crate::sysfs::Sysfs;

pub(crate) use crate::knobs::Value as KnobValue;
pub(crate) use error::OpError;

/// A laptop chassis, by DMI type (docs/0.4.0.html): laptop, notebook,
/// hand-held, sub-notebook, convertible, detachable.
const LAPTOP_CHASSIS: [&str; 6] = ["8", "9", "10", "14", "31", "32"];

pub(crate) struct Machine {
    pub(crate) sysfs: Sysfs,
    model: Option<Model>,
    knobs: Vec<Found>,
    fans: Vec<Fan>,
    slash: Option<Bar>,
    state: State,
}

impl Machine {
    pub(crate) fn open(sysfs: Sysfs, models_dir: &std::path::Path) -> Self {
        let dmi = Dmi::read(&sysfs);
        let model = model::find(models_dir, &dmi);
        let knobs = knobs::discover(&sysfs, model.as_ref());
        let fans = fans::discover(&sysfs);
        let slash = Bar::from_model(model.as_ref());
        let state = State::for_sysfs(&sysfs);
        Self {
            sysfs,
            model,
            knobs,
            fans,
            slash,
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

    /// The polkit action a `SetMany` of `values` needs: the strongest any
    /// knob needs. Only a result of `Tune` is ever lowered, and only to
    /// `Everyday`: `tune` knobs set to one of the model's own recipe columns
    /// are a mode switch, an everyday change (docs/hardware.md, "Knobs"). A
    /// knob that needs more than `Tune` keeps what it needs.
    pub(crate) fn action_for_many(&self, values: &[(Knob, KnobValue)]) -> knobs::Action {
        let strongest = values
            .iter()
            .map(|(knob, _)| knob.action())
            .max()
            .unwrap_or(knobs::Action::Everyday);
        if strongest != knobs::Action::Tune {
            return strongest;
        }
        let tuned: Vec<(&str, Value)> = values
            .iter()
            .filter(|(knob, _)| knob.action() == knobs::Action::Tune)
            .map(|(knob, value)| (knob.name(), value.json()))
            .collect();
        let shipped = self.model.as_ref().is_some_and(|m| m.recipe_gives(&tuned));
        if shipped {
            knobs::Action::Everyday
        } else {
            knobs::Action::Tune
        }
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
            // The bar is there when the model names it and its device is found.
            "slash": self.slash.is_some_and(|bar| bar.node(&self.sysfs).is_some()),
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
}
