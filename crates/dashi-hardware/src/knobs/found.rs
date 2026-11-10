//! A knob this machine has: its spec, where it lives in sysfs, and reading,
//! clamping, writing and describing it.

use std::io;

use serde_json::{Map, json};

use super::knob::Knob;
use super::value::Value;
use super::{attrs, cpu, power, profile};
use crate::sysfs::Sysfs;

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
                    Err(format!(
                        "{}: {s} is not one of {}",
                        self.knob.name(),
                        choices.join(", ")
                    ))
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
            self.read(sysfs)
                .map(|v| v.json())
                .unwrap_or(serde_json::Value::Null),
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
