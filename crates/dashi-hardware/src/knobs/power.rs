//! `charge-limit` (every system battery's `charge_control_end_threshold`)
//! and `kbd-backlight` (`/sys/class/leds/*::kbd_backlight`).

use std::io;

use super::{Backend, Found, Knob, Spec, Value};
use crate::sysfs::Sysfs;

const SUPPLIES: &str = "class/power_supply";
const LEDS: &str = "class/leds";
/// The kernel gives no lower bound; below this a limit only wears the
/// battery's usefulness, not the battery.
const CHARGE_FLOOR: u32 = 20;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Power {
    ChargeLimit { batteries: Vec<String> },
    KbdBacklight { led: String },
}

/// The system's batteries (not a mouse's: scope `Device` is left out).
pub(crate) fn batteries(sysfs: &Sysfs) -> Vec<String> {
    sysfs
        .list(SUPPLIES)
        .into_iter()
        .filter(|name| {
            sysfs.read(&format!("{SUPPLIES}/{name}/type")).as_deref() == Some("Battery")
                && sysfs.read(&format!("{SUPPLIES}/{name}/scope")).as_deref() != Some("Device")
        })
        .collect()
}

pub(super) fn discover(sysfs: &Sysfs, knob: Knob) -> Option<Found> {
    let (spec, backend) = match knob {
        Knob::ChargeLimit => {
            let batteries: Vec<String> = batteries(sysfs)
                .into_iter()
                .filter(|bat| sysfs.exists(&format!("{SUPPLIES}/{bat}/charge_control_end_threshold")))
                .collect();
            if batteries.is_empty() {
                return None;
            }
            let spec = Spec::Range {
                min: CHARGE_FLOOR,
                max: 100,
                step: 1,
                unit: Some("%"),
                zero_means_off: false,
            };
            (spec, Power::ChargeLimit { batteries })
        }
        Knob::KbdBacklight => {
            let led = sysfs
                .list(LEDS)
                .into_iter()
                .find(|name| name.ends_with("::kbd_backlight"))?;
            let max = u32::try_from(sysfs.read_u64(&format!("{LEDS}/{led}/max_brightness"))?).ok()?;
            if max == 0 {
                return None;
            }
            let spec = Spec::Range {
                min: 0,
                max,
                step: 1,
                unit: None,
                zero_means_off: false,
            };
            (spec, Power::KbdBacklight { led })
        }
        _ => return None,
    };
    Some(Found {
        knob,
        spec,
        backend: Backend::Power(backend),
    })
}

impl Power {
    fn file(&self) -> Option<String> {
        match self {
            Power::ChargeLimit { batteries } => Some(format!(
                "{SUPPLIES}/{}/charge_control_end_threshold",
                batteries.first()?
            )),
            Power::KbdBacklight { led } => Some(format!("{LEDS}/{led}/brightness")),
        }
    }

    /// The files to poll: Fn F4 raises `brightness_hw_changed`.
    pub(crate) fn watched(&self) -> Vec<String> {
        let mut files: Vec<String> = self.file().into_iter().collect();
        if let Power::KbdBacklight { led } = self {
            files.push(format!("{LEDS}/{led}/brightness_hw_changed"));
        }
        files
    }

    pub(super) fn read(&self, sysfs: &Sysfs) -> Option<Value> {
        let raw = u32::try_from(sysfs.read_u64(&self.file()?)?).ok()?;
        Some(Value::U32(raw))
    }

    pub(super) fn write(&self, sysfs: &Sysfs, value: &Value) -> io::Result<()> {
        let Value::U32(n) = value else {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "a number"));
        };
        match self {
            Power::ChargeLimit { batteries } => {
                for bat in batteries {
                    sysfs.write(&format!("{SUPPLIES}/{bat}/charge_control_end_threshold"), &n.to_string())?;
                }
                Ok(())
            }
            Power::KbdBacklight { led } => sysfs.write(&format!("{LEDS}/{led}/brightness"), &n.to_string()),
        }
    }
}
