//! cpufreq knobs: `boost`, `epp` (amd_pstate's and intel_pstate's energy
//! performance preference) and `cpu-max-freq`, written to every CPU.

use std::io;

use super::{Backend, Found, Knob, Spec, Value};
use crate::sysfs::Sysfs;

const CPUS: &str = "devices/system/cpu";
const BOOST: &str = "devices/system/cpu/cpufreq/boost";

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Cpu {
    Boost,
    Epp { cpus: Vec<String> },
    MaxFreq { cpus: Vec<String>, max: u32 },
}

/// The CPUs with a cpufreq policy (`cpu0`, `cpu1`, …), in number order.
pub(crate) fn cpus(sysfs: &Sysfs) -> Vec<String> {
    let mut cpus: Vec<(u32, String)> = sysfs
        .list(CPUS)
        .into_iter()
        .filter_map(|name| Some((name.strip_prefix("cpu")?.parse().ok()?, name)))
        .filter(|(_, name)| sysfs.exists(&format!("{CPUS}/{name}/cpufreq")))
        .collect();
    cpus.sort();
    cpus.into_iter().map(|(_, name)| name).collect()
}

fn file(cpu: &str, name: &str) -> String {
    format!("{CPUS}/{cpu}/cpufreq/{name}")
}

pub(super) fn discover(sysfs: &Sysfs, knob: Knob) -> Option<Found> {
    let cpus = cpus(sysfs);
    let first = cpus.first().cloned();
    let (spec, backend) = match knob {
        Knob::Boost => {
            sysfs.read(BOOST)?;
            (Spec::Bool, Cpu::Boost)
        }
        Knob::Epp => {
            let available = sysfs.read(&file(first.as_deref()?, "energy_performance_available_preferences"))?;
            // "custom" names a raw number written elsewhere, not a choice.
            let choices: Vec<String> = available
                .split_whitespace()
                .filter(|c| *c != "custom")
                .map(str::to_owned)
                .collect();
            if choices.is_empty() {
                return None;
            }
            (Spec::Choices(choices), Cpu::Epp { cpus })
        }
        Knob::CpuMaxFreq => {
            let cpu = first.as_deref()?;
            let min = u32::try_from(sysfs.read_u64(&file(cpu, "cpuinfo_min_freq"))?).ok()?;
            let max = u32::try_from(sysfs.read_u64(&file(cpu, "cpuinfo_max_freq"))?).ok()?;
            sysfs.read(&file(cpu, "scaling_max_freq"))?;
            if min == 0 || min > max {
                return None;
            }
            let spec = Spec::Range {
                min,
                max,
                step: 1,
                unit: Some("kHz"),
                zero_means_off: true,
            };
            (spec, Cpu::MaxFreq { cpus, max })
        }
        _ => return None,
    };
    Some(Found {
        knob,
        spec,
        backend: Backend::Cpu(backend),
    })
}

impl Cpu {
    pub(crate) fn watched(&self) -> Option<String> {
        match self {
            Cpu::Boost => Some(BOOST.to_owned()),
            Cpu::Epp { cpus } => Some(file(cpus.first()?, "energy_performance_preference")),
            Cpu::MaxFreq { cpus, .. } => Some(file(cpus.first()?, "scaling_max_freq")),
        }
    }

    pub(super) fn read(&self, sysfs: &Sysfs) -> Option<Value> {
        let raw = sysfs.read(&self.watched()?)?;
        Some(match self {
            Cpu::Boost => Value::Bool(raw == "1"),
            Cpu::Epp { .. } => Value::Str(raw),
            Cpu::MaxFreq { max, .. } => {
                let now: u32 = raw.parse().ok()?;
                // The driver rounds what it is given: within 0.1% of the top is no cap.
                let uncapped = u64::from(now) * 1000 >= u64::from(*max) * 999;
                Value::U32(if uncapped { 0 } else { now })
            }
        })
    }

    pub(super) fn write(&self, sysfs: &Sysfs, value: &Value) -> io::Result<()> {
        match (self, value) {
            (Cpu::Boost, Value::Bool(on)) => sysfs.write(BOOST, if *on { "1" } else { "0" }),
            (Cpu::Epp { cpus }, Value::Str(preference)) => {
                for cpu in cpus {
                    sysfs.write(&file(cpu, "energy_performance_preference"), preference)?;
                }
                Ok(())
            }
            (Cpu::MaxFreq { cpus, max }, Value::U32(khz)) => {
                let target = if *khz == 0 { *max } else { *khz };
                for cpu in cpus {
                    sysfs.write(&file(cpu, "scaling_max_freq"), &target.to_string())?;
                }
                Ok(())
            }
            _ => Err(io::Error::new(io::ErrorKind::InvalidInput, "wrong type")),
        }
    }
}
