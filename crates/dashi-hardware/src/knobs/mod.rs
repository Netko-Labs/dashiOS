//! Knobs: the named settings a machine has (docs/hardware.md, "Knobs"),
//! found in sysfs, each with its range and the polkit action that guards it.

mod attrs;
mod cpu;
mod power;
mod profile;
mod value;

use std::io;

use serde_json::{Map, json};

pub(crate) use cpu::cpus as cpu_names;
pub(crate) use value::{Kind, Value};

use crate::model::Model;
use crate::sysfs::Sysfs;

/// Every knob, in the order `SetMany` writes them: the platform profile
/// first (on ASUS it resets the power limits), the limits after it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Knob {
    PlatformProfile,
    Epp,
    Boost,
    CpuMaxFreq,
    PptSpl,
    PptSppt,
    PptFppt,
    NvTgp,
    NvDynamicBoost,
    NvTempTarget,
    ChargeLimit,
    KbdBacklight,
    PanelOverdrive,
    GpuMux,
}

/// The polkit action a change needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Action {
    Everyday,
    Tune,
}

impl Action {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Action::Everyday => "dev.dashi.hardware.everyday",
            Action::Tune => "dev.dashi.hardware.tune",
        }
    }
}

impl Knob {
    pub(crate) const ALL: [Knob; 14] = [
        Knob::PlatformProfile,
        Knob::Epp,
        Knob::Boost,
        Knob::CpuMaxFreq,
        Knob::PptSpl,
        Knob::PptSppt,
        Knob::PptFppt,
        Knob::NvTgp,
        Knob::NvDynamicBoost,
        Knob::NvTempTarget,
        Knob::ChargeLimit,
        Knob::KbdBacklight,
        Knob::PanelOverdrive,
        Knob::GpuMux,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Knob::PlatformProfile => "platform-profile",
            Knob::Epp => "epp",
            Knob::Boost => "boost",
            Knob::CpuMaxFreq => "cpu-max-freq",
            Knob::PptSpl => "ppt-spl",
            Knob::PptSppt => "ppt-sppt",
            Knob::PptFppt => "ppt-fppt",
            Knob::NvTgp => "nv-tgp",
            Knob::NvDynamicBoost => "nv-dynamic-boost",
            Knob::NvTempTarget => "nv-temp-target",
            Knob::ChargeLimit => "charge-limit",
            Knob::KbdBacklight => "kbd-backlight",
            Knob::PanelOverdrive => "panel-overdrive",
            Knob::GpuMux => "gpu-mux",
        }
    }

    pub(crate) fn from_name(name: &str) -> Option<Knob> {
        Knob::ALL.into_iter().find(|knob| knob.name() == name)
    }

    pub(crate) fn kind(self) -> Kind {
        match self {
            Knob::PlatformProfile | Knob::Epp => Kind::Str,
            Knob::Boost | Knob::PanelOverdrive => Kind::Bool,
            _ => Kind::U32,
        }
    }

    pub(crate) fn action(self) -> Action {
        match self {
            Knob::PptSpl
            | Knob::PptSppt
            | Knob::PptFppt
            | Knob::NvTgp
            | Knob::NvDynamicBoost
            | Knob::NvTempTarget
            | Knob::GpuMux => Action::Tune,
            _ => Action::Everyday,
        }
    }
}

/// What values a knob takes on this machine.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Spec {
    Choices(Vec<String>),
    Range {
        min: u32,
        max: u32,
        step: u32,
        unit: Option<&'static str>,
        /// 0 is accepted besides the range (`cpu-max-freq`: no cap).
        zero_means_off: bool,
    },
    Bool,
}

/// Where a knob lives in sysfs.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Backend {
    Profile(profile::Profile),
    Attr(attrs::Attr),
    Cpu(cpu::Cpu),
    Power(power::Power),
}

/// A knob this machine has.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Found {
    pub(crate) knob: Knob,
    pub(crate) spec: Spec,
    pub(crate) backend: Backend,
}

impl Found {
    pub(crate) fn read(&self, sysfs: &Sysfs) -> Option<Value> {
        match &self.backend {
            Backend::Profile(p) => p.read(sysfs),
            Backend::Attr(a) => a.read(sysfs, self.knob.kind()),
            Backend::Cpu(c) => c.read(sysfs),
            Backend::Power(p) => p.read(sysfs),
        }
    }

    /// The files whose change means this knob changed (polled).
    pub(crate) fn watched(&self) -> Vec<String> {
        match &self.backend {
            Backend::Profile(p) => p.watched(),
            Backend::Attr(a) => vec![a.watched()],
            Backend::Cpu(c) => c.watched().into_iter().collect(),
            Backend::Power(p) => p.watched(),
        }
    }

    /// Clamp or check `value` against the spec: what would be written.
    pub(crate) fn clamp(&self, value: Value) -> Result<Value, String> {
        match (&self.spec, value) {
            (Spec::Choices(choices), Value::Str(s)) => {
                if choices.contains(&s) {
                    Ok(Value::Str(s))
                } else {
                    Err(format!("{}: {s} is not one of {}", self.knob.name(), choices.join(", ")))
                }
            }
            (Spec::Bool, Value::Bool(b)) => Ok(Value::Bool(b)),
            (
                Spec::Range {
                    min,
                    max,
                    step,
                    zero_means_off,
                    ..
                },
                Value::U32(n),
            ) => {
                if n == 0 && *zero_means_off {
                    return Ok(Value::U32(0));
                }
                let clamped = n.clamp(*min, *max);
                let stepped = if *step > 1 {
                    (min + (clamped - min) / step * step).min(*max)
                } else {
                    clamped
                };
                Ok(Value::U32(stepped))
            }
            (_, other) => Err(format!("{}: {other} has the wrong type", self.knob.name())),
        }
    }

    /// Clamp, then write; returns what was written.
    pub(crate) fn set(&self, sysfs: &Sysfs, value: Value) -> Result<Value, SetError> {
        let value = self.clamp(value).map_err(SetError::Invalid)?;
        let result = match &self.backend {
            Backend::Profile(p) => p.write(sysfs, &value),
            Backend::Attr(a) => a.write(sysfs, &value),
            Backend::Cpu(c) => c.write(sysfs, &value),
            Backend::Power(p) => p.write(sysfs, &value),
        };
        result.map(|()| value).map_err(SetError::Io)
    }

    /// The knob as `Describe` shows it.
    pub(crate) fn describe(&self, sysfs: &Sysfs) -> serde_json::Value {
        let mut out = Map::new();
        out.insert(
            "value".into(),
            self.read(sysfs).map(|v| v.json()).unwrap_or(serde_json::Value::Null),
        );
        match &self.spec {
            Spec::Choices(choices) => {
                out.insert("choices".into(), json!(choices));
            }
            Spec::Range { min, max, unit, .. } => {
                out.insert("min".into(), json!(min));
                out.insert("max".into(), json!(max));
                if let Some(unit) = unit {
                    out.insert("unit".into(), json!(unit));
                }
            }
            Spec::Bool => {}
        }
        if let Backend::Attr(attr) = &self.backend
            && self.knob == Knob::GpuMux
        {
            out.insert("pendingReboot".into(), json!(attr.pending_reboot(sysfs)));
        }
        serde_json::Value::Object(out)
    }
}

#[derive(Debug)]
pub(crate) enum SetError {
    Invalid(String),
    Io(io::Error),
}

/// Every knob this machine has, in `Knob::ALL`'s order.
pub(crate) fn discover(sysfs: &Sysfs, model: Option<&Model>) -> Vec<Found> {
    let mut found = Vec::new();
    for knob in Knob::ALL {
        let discovered = match knob {
            Knob::PlatformProfile => profile::discover(sysfs),
            Knob::Epp | Knob::Boost | Knob::CpuMaxFreq => cpu::discover(sysfs, knob),
            Knob::ChargeLimit | Knob::KbdBacklight => power::discover(sysfs, knob),
            _ => attrs::discover(sysfs, knob),
        };
        if let Some(mut f) = discovered {
            narrow(&mut f, model);
            found.push(f);
        }
    }
    found
}

/// The model can narrow a numeric range, never widen it.
fn narrow(found: &mut Found, model: Option<&Model>) {
    let Some((lo, hi)) = model.and_then(|m| m.limit(found.knob.name())) else {
        return;
    };
    if let Spec::Range { min, max, .. } = &mut found.spec {
        let (new_min, new_max) = ((*min).max(lo), (*max).min(hi));
        if new_min <= new_max {
            *min = new_min;
            *max = new_max;
        }
    }
}

#[cfg(test)]
mod tests;
