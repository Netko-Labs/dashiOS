//! Finding the knobs a machine has, and narrowing their ranges to the model.

use super::found::{Found, Spec};
use super::knob::Knob;
use super::{attrs, cpu, power, profile};
use crate::model::Model;
use crate::sysfs::Sysfs;

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
