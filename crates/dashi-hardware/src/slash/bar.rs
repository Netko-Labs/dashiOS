//! One machine's Slash bar: its USB id from the model database, the hidraw
//! node it is at now, and the operations `Slash`, `SetSlash` and the
//! re-apply after boot and waking share.

use std::io;

use serde_json::{Value, json};

use super::device::{self, Device};
use super::packet::{self, MODES, Show};
use super::settings::{Change, INTERVAL_MAX, Settings};
use crate::model::Model;
use crate::state::State;
use crate::sysfs::Sysfs;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Bar {
    vendor: u16,
    product: u16,
    report: u8,
}

#[derive(Debug)]
pub(crate) enum SlashError {
    /// The model names a bar but its device isn't there.
    NoDevice,
    Io(String),
}

impl std::fmt::Display for SlashError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SlashError::NoDevice => write!(f, "the Slash bar's device isn't there"),
            SlashError::Io(s) => write!(f, "the Slash bar: {s}"),
        }
    }
}

impl From<io::Error> for SlashError {
    fn from(e: io::Error) -> Self {
        SlashError::Io(e.to_string())
    }
}

impl Bar {
    /// The bar the model names (`lighting.slash.usb`), if any.
    pub(crate) fn from_model(model: Option<&Model>) -> Option<Bar> {
        let usb = &model?.lighting.as_ref()?.slash.as_ref()?.usb;
        let (vendor, product) = device::parse_usb_id(usb)?;
        Some(Bar {
            vendor,
            product,
            report: packet::report_id(product),
        })
    }

    /// The hidraw node it is at now, looked up each time: it moves when the
    /// device comes back after a reset.
    pub(crate) fn node(&self, sysfs: &Sysfs) -> Option<String> {
        device::find(sysfs, self.vendor, self.product, self.report)
    }

    /// `Slash()`'s JSON: the saved settings (asusd's defaults before any),
    /// the animations, the ranges.
    pub(crate) fn describe(&self, sysfs: &Sysfs, state: &State) -> Value {
        let Some(node) = self.node(sysfs) else {
            return unavailable("no-device");
        };
        let saved = state.saved_slash();
        let mut map = saved.clone().unwrap_or_default().json();
        map.insert("available".into(), json!(true));
        map.insert("reason".into(), json!(""));
        map.insert("device".into(), json!(node));
        map.insert("saved".into(), json!(saved.is_some()));
        map.insert(
            "modes".into(),
            json!(MODES.iter().map(|(id, _)| *id).collect::<Vec<_>>()),
        );
        map.insert(
            "limits".into(),
            json!({"brightness": [0, u8::MAX], "interval": [0, INTERVAL_MAX]}),
        );
        Value::Object(map)
    }

    /// Apply `change`, send what differs, and save the result.
    pub(crate) fn set(
        &self,
        sysfs: &Sysfs,
        state: &State,
        change: &Change,
    ) -> Result<Settings, SlashError> {
        let node = self.node(sysfs).ok_or(SlashError::NoDevice)?;
        let current = state.saved_slash();
        let mut device = device::open(sysfs, &node)?;
        let next = apply(device.as_mut(), self.report, current.as_ref(), change)?;
        state.save_slash(&next)?;
        Ok(next)
    }

    /// Send the saved settings again (after boot, after waking). `false`
    /// when nothing was saved: a bar the helper never set is left alone.
    pub(crate) fn restore(&self, sysfs: &Sysfs, state: &State) -> Result<bool, SlashError> {
        let Some(saved) = state.saved_slash() else {
            return Ok(false);
        };
        let node = self.node(sysfs).ok_or(SlashError::NoDevice)?;
        let mut device = device::open(sysfs, &node)?;
        send(device.as_mut(), &saved.restore_packets(self.report))?;
        Ok(true)
    }
}

/// `Slash()` on a machine without a bar: `not-in-database` or `no-device`.
pub(crate) fn unavailable(reason: &str) -> Value {
    json!({"available": false, "reason": reason})
}

/// Take the bar from `current` to `current` with `change` applied. The first change
/// the helper makes (nothing saved yet) starts the bar the way asusd does at
/// start-up and sends every setting, since the bar's state is unknown.
pub(crate) fn apply(
    device: &mut dyn Device,
    report: u8,
    current: Option<&Settings>,
    change: &Change,
) -> io::Result<Settings> {
    let (next, packets) = match current {
        Some(current) => {
            let next = current.with(change);
            let packets = current.packets_to(&next, report);
            (next, packets)
        }
        None => {
            let next = Settings::default().with(change);
            let mut packets = next.restore_packets(report);
            // The rest of a full set: the lid-closed flag and a save, which
            // asusd's start-up leaves out.
            let lid = Show::LidClosed;
            packets.push(lid.packet(report, next.show(lid)));
            packets.push(packet::save(report));
            (next, packets)
        }
    };
    send(device, &packets)?;
    Ok(next)
}

fn send(device: &mut dyn Device, packets: &[Vec<u8>]) -> io::Result<()> {
    packets.iter().try_for_each(|packet| device.write(packet))
}
