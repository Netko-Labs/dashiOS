//! Knobs: the named settings a machine has (docs/hardware.md, "Knobs"),
//! found in sysfs, each with its range and the polkit action that guards it.

mod attrs;
mod cpu;
mod discover;
mod found;
mod knob;
mod power;
mod profile;
#[cfg(test)]
mod tests;
mod value;

pub(crate) use cpu::cpus as cpu_names;
pub(crate) use discover::discover;
pub(crate) use found::{Backend, Found, SetError, Spec};
pub(crate) use knob::{Action, Knob};
pub(crate) use power::batteries as batteries_present;
pub(crate) use value::{Kind, Value};
