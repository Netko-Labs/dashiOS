//! Knobs from firmware attributes
//! (`/sys/class/firmware-attributes/*/attributes/*`, asus-armoury first):
//! the power limits, the graphics card's limits, panel overdrive, the MUX.

use std::io;

use super::{Backend, Found, Kind, Knob, Spec, Value};
use crate::sysfs::Sysfs;

const CLASS: &str = "class/firmware-attributes";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Attr {
    /// The attribute's directory, relative to the root.
    dir: String,
    /// The device's `attributes/` directory (for `pending_reboot`).
    device: String,
}

fn attribute(knob: Knob) -> Option<(&'static str, Option<&'static str>)> {
    Some(match knob {
        Knob::PptSpl => ("ppt_pl1_spl", Some("W")),
        Knob::PptSppt => ("ppt_pl2_sppt", Some("W")),
        Knob::PptFppt => ("ppt_pl3_fppt", Some("W")),
        Knob::NvTgp => ("nv_tgp", Some("W")),
        Knob::NvDynamicBoost => ("nv_dynamic_boost", Some("W")),
        Knob::NvTempTarget => ("nv_temp_target", Some("°C")),
        Knob::PanelOverdrive => ("panel_overdrive", None),
        Knob::GpuMux => ("gpu_mux_mode", None),
        _ => return None,
    })
}

/// The firmware-attributes devices, asus-armoury first.
fn devices(sysfs: &Sysfs) -> Vec<String> {
    let mut devices = sysfs.list(CLASS);
    devices.sort_by_key(|name| (name != "asus-armoury", name.clone()));
    devices
}

fn numbers(text: &str) -> Vec<u32> {
    text.split([';', ','])
        .filter_map(|word| word.trim().parse().ok())
        .collect()
}

pub(super) fn discover(sysfs: &Sysfs, knob: Knob) -> Option<Found> {
    let (name, unit) = attribute(knob)?;
    let device = devices(sysfs)
        .into_iter()
        .find(|device| sysfs.exists(&format!("{CLASS}/{device}/attributes/{name}/current_value")))?;
    let dir = format!("{CLASS}/{device}/attributes/{name}");
    let read = |file: &str| sysfs.read(&format!("{dir}/{file}"));
    let possible = read("possible_values").map(|text| numbers(&text));
    let spec = match knob.kind() {
        Kind::Bool => {
            let values = possible?;
            if !(values.contains(&0) && values.contains(&1)) {
                return None;
            }
            Spec::Bool
        }
        Kind::U32 => {
            let (min, max) = match (read("min_value"), read("max_value"), possible) {
                (Some(min), Some(max), _) => (min.parse().ok()?, max.parse().ok()?),
                (_, _, Some(values)) if !values.is_empty() => {
                    (*values.iter().min()?, *values.iter().max()?)
                }
                _ => return None,
            };
            if min > max {
                return None;
            }
            let step = read("scalar_increment")
                .and_then(|s| s.parse().ok())
                .filter(|s: &u32| *s > 0)
                .unwrap_or(1);
            Spec::Range {
                min,
                max,
                step,
                unit,
                zero_means_off: false,
            }
        }
        Kind::Str => return None,
    };
    Some(Found {
        knob,
        spec,
        backend: Backend::Attr(Attr {
            dir,
            device: format!("{CLASS}/{device}/attributes"),
        }),
    })
}

impl Attr {
    pub(crate) fn watched(&self) -> String {
        format!("{}/current_value", self.dir)
    }

    pub(super) fn read(&self, sysfs: &Sysfs, kind: Kind) -> Option<Value> {
        let raw: u32 = sysfs.read(&self.watched())?.parse().ok()?;
        Some(match kind {
            Kind::Bool => Value::Bool(raw != 0),
            _ => Value::U32(raw),
        })
    }

    pub(super) fn write(&self, sysfs: &Sysfs, value: &Value) -> io::Result<()> {
        let text = match value {
            Value::U32(n) => n.to_string(),
            Value::Bool(b) => u32::from(*b).to_string(),
            Value::Str(_) => {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "a number"));
            }
        };
        sysfs.write(&self.watched(), &text)?;
        // The firmware asks for a restart (the MUX): the kernel raises
        // pending_reboot itself; a fake tree is told.
        if sysfs.is_fake() && self.dir.ends_with("/gpu_mux_mode") {
            let _ = sysfs.write(&format!("{}/pending_reboot", self.device), "1");
        }
        Ok(())
    }

    pub(super) fn pending_reboot(&self, sysfs: &Sysfs) -> bool {
        sysfs
            .read(&format!("{}/pending_reboot", self.device))
            .is_some_and(|v| v == "1")
    }
}
