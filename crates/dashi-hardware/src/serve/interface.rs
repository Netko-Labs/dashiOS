//! The `dev.dashi.Hardware1` interface, its methods and the `Changed` signal.

use std::collections::HashMap;
use std::sync::Arc;

use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};
use zbus::{fdo, interface, message::Header};

use super::convert::{self, to_fdo};
use super::{Shared, curve, polkit};
use crate::knobs::{Action, Knob, Value as KnobValue};
use crate::machine::{Machine, OpError};

pub(crate) struct Hardware1 {
    shared: Arc<Shared>,
    fake: bool,
}

impl Hardware1 {
    pub(crate) fn new(shared: Arc<Shared>) -> Self {
        let fake = shared
            .machine
            .lock()
            .map(|m| m.sysfs.is_fake())
            .unwrap_or(false);
        Self { shared, fake }
    }

    fn machine(&self) -> std::sync::MutexGuard<'_, Machine> {
        self.shared
            .machine
            .lock()
            .expect("the machine lock is never poisoned")
    }

    async fn authorize(
        &self,
        connection: &zbus::Connection,
        header: &Header<'_>,
        action: Action,
    ) -> fdo::Result<()> {
        let sender = header.sender().map(|s| s.as_str());
        match polkit::allowed(connection, sender, action, self.fake).await {
            Ok(true) => Ok(()),
            Ok(false) => Err(fdo::Error::AccessDenied(format!(
                "not authorized for {}",
                action.id()
            ))),
            Err(e) => Err(fdo::Error::Failed(format!("polkit: {e}"))),
        }
    }
}

#[interface(name = "dev.dashi.Hardware1")]
impl Hardware1 {
    /// The machine, as JSON (docs/hardware.md, "Describe").
    async fn describe(&self) -> String {
        self.machine().describe().to_string()
    }

    async fn get(&self, knob: String) -> fdo::Result<OwnedValue> {
        self.machine()
            .get(&knob)
            .map(|v| v.variant())
            .map_err(to_fdo)
    }

    async fn set(
        &self,
        knob: String,
        value: Value<'_>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<OwnedValue> {
        let action = self
            .machine()
            .action_for(&knob)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("{knob} is not a knob")))?;
        self.authorize(connection, &header, action).await?;
        let kind = Knob::from_name(&knob)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("{knob} is not a knob")))?
            .kind();
        let parsed = KnobValue::from_variant(kind, &value).map_err(fdo::Error::InvalidArgs)?;
        let applied = self.machine().set(&knob, parsed).map_err(to_fdo)?;
        let _ = Self::changed(&emitter, &knob, applied.variant().into()).await;
        Ok(applied.variant())
    }

    /// One recipe in one call, each knob written once, in a fixed order
    /// (profile first). Returns what was written for each.
    async fn set_many(
        &self,
        values: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> fdo::Result<HashMap<String, OwnedValue>> {
        let parsed = convert::knob_values(&values)?;
        // A mode switch to the model's own recipe needs no password.
        let needed = self.machine().action_for_many(&parsed);
        self.authorize(connection, &header, needed).await?;

        let mut applied = HashMap::new();
        for (knob, value) in parsed {
            let result = self.machine().set(knob.name(), value);
            match result {
                Ok(value) => {
                    let _ = Self::changed(&emitter, knob.name(), value.variant().into()).await;
                    applied.insert(knob.name().to_owned(), value.variant());
                }
                Err(OpError::NotFound(_)) => {} // the machine lacks it; skip
                Err(e) => return Err(to_fdo(e)),
            }
        }
        Ok(applied)
    }

    /// The lid's Slash bar, as JSON (docs/hardware.md, "The Slash bar").
    async fn slash(&self) -> String {
        self.machine().slash_json().to_string()
    }

    /// Set the Slash bar: any of its keys, validated and clamped; saved and
    /// sent again after boot and waking. Returns `Slash()`'s JSON.
    async fn set_slash(
        &self,
        values: HashMap<String, OwnedValue>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<String> {
        let change = convert::slash_change(&values)?;
        self.authorize(connection, &header, Action::Everyday)
            .await?;
        let machine = self.machine();
        machine
            .set_slash(&change)
            .map(|json| json.to_string())
            .map_err(to_fdo)
    }

    async fn get_fan_curve(&self, fan: String) -> fdo::Result<Vec<(u8, u8)>> {
        self.machine().fan_curve(&fan).map_err(to_fdo)
    }

    async fn set_fan_curve(
        &self,
        fan: String,
        points: Vec<(u8, u8)>,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<()> {
        self.authorize(connection, &header, Action::Tune).await?;
        self.machine().set_fan_curve(&fan, &points).map_err(to_fdo)
    }

    async fn reset_fan_curves(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<()> {
        self.authorize(connection, &header, Action::Tune).await?;
        self.machine().reset_fan_curves().map_err(to_fdo)
    }

    async fn curve_optimizer(&self) -> String {
        let machine = self.machine();
        let tuning = machine.state().saved_tuning();
        machine.curve_optimizer_json(&tuning).to_string()
    }

    /// Apply a Curve Optimizer offset now, reverting to 0 unless confirmed
    /// within `confirm_within` seconds. Returns the confirmation token.
    async fn set_curve_optimizer(
        &self,
        all_core: i32,
        per_core: Vec<i32>,
        confirm_within: u32,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<String> {
        self.authorize(connection, &header, Action::Tune).await?;
        curve::apply_pending(&self.shared, all_core, &per_core, confirm_within)
    }

    /// Keep a pending Curve Optimizer change, and save it for the boot guard.
    async fn confirm_tuning(&self, token: String) -> fdo::Result<()> {
        curve::confirm(&self.shared, &token)
    }

    async fn apply_saved_tuning(&self) -> String {
        self.machine().apply_saved_tuning().to_string()
    }

    async fn clear_saved_tuning(
        &self,
        #[zbus(connection)] connection: &zbus::Connection,
        #[zbus(header)] header: Header<'_>,
    ) -> fdo::Result<()> {
        self.authorize(connection, &header, Action::Tune).await?;
        self.machine()
            .state()
            .clear_tuning()
            .map_err(|e| fdo::Error::Failed(e.to_string()))
    }

    async fn boot_guard(&self) -> String {
        self.machine().boot_guard().to_string()
    }

    /// A knob changed, by Dashi or anything else. `""` and an empty value
    /// mean "describe again".
    #[zbus(signal)]
    pub(crate) async fn changed(
        emitter: &SignalEmitter<'_>,
        knob: &str,
        value: Value<'_>,
    ) -> zbus::Result<()>;
}
