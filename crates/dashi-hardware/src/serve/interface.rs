//! The `dev.dashi.Hardware1` interface, its methods and the `Changed` signal.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use zbus::object_server::SignalEmitter;
use zbus::zvariant::{OwnedValue, Value};
use zbus::{fdo, interface, message::Header};

use super::{INTERFACE, OBJECT_PATH, Pending, Shared, countdown, polkit};
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

fn to_fdo(error: OpError) -> fdo::Error {
    match error {
        OpError::NotFound(s) => fdo::Error::InvalidArgs(format!("{s} is not on this machine")),
        OpError::Invalid(s) => fdo::Error::InvalidArgs(s),
        OpError::Io(s) => fdo::Error::Failed(s),
        OpError::Unavailable(s) => fdo::Error::NotSupported(s),
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
        let mut parsed = Vec::new();
        for knob in Knob::ALL {
            if let Some(raw) = values.get(knob.name()) {
                let value =
                    KnobValue::from_variant(knob.kind(), raw).map_err(fdo::Error::InvalidArgs)?;
                parsed.push((knob, value));
            }
        }
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
        let pairs: Vec<(u32, i32)> = per_core
            .iter()
            .enumerate()
            .map(|(core, offset)| (core as u32, *offset))
            .collect();
        self.machine()
            .apply_curve_optimizer(if pairs.is_empty() { all_core } else { 0 }, &pairs)
            .map_err(to_fdo)?;
        let token = countdown::new_token();
        let all_core = (pairs.is_empty()).then_some(all_core);
        if let Ok(mut pending) = self.shared.pending.lock() {
            pending.insert(
                token.clone(),
                Pending {
                    all_core,
                    per_core: pairs,
                },
            );
        }
        countdown::arm(Arc::clone(&self.shared), token.clone(), confirm_within);
        Ok(token)
    }

    /// Keep a pending Curve Optimizer change, and save it for the boot guard.
    async fn confirm_tuning(&self, token: String) -> fdo::Result<()> {
        let pending = self
            .shared
            .pending
            .lock()
            .ok()
            .and_then(|mut p| p.remove(&token))
            .ok_or_else(|| {
                fdo::Error::InvalidArgs("no such token (it may have timed out)".into())
            })?;
        let machine = self.machine();
        let tuning = machine.tuning_snapshot(pending.all_core, &pending.per_core);
        machine
            .state()
            .save_tuning(&tuning)
            .map_err(|e| fdo::Error::Failed(e.to_string()))
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

/// Poll the sysfs files the knobs live in (platform_profile notifies, Fn F5
/// and Fn F4 raise the `*_hw_changed` markers); emit `Changed` for a knob
/// whose files moved, by Dashi or anything else. Contents are compared as
/// read.
pub(crate) fn spawn_poll(connection: zbus::blocking::Connection, shared: Arc<Shared>) {
    std::thread::spawn(move || {
        let watched = shared
            .machine
            .lock()
            .map(|m| m.watched_files())
            .unwrap_or_default();
        let mut seen: HashMap<String, Option<String>> = HashMap::new();
        let mut first_pass = true;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let mut touched: Vec<&'static str> = Vec::new();
            {
                let machine = match shared.machine.lock() {
                    Ok(machine) => machine,
                    Err(_) => continue,
                };
                for (file, knob) in &watched {
                    let now = machine.sysfs.read(file);
                    if seen.get(file) != Some(&now) {
                        seen.insert(file.clone(), now);
                        if !first_pass && !touched.contains(knob) {
                            touched.push(knob);
                        }
                    }
                }
            }
            first_pass = false;
            for knob in touched {
                let value = shared.machine.lock().ok().and_then(|m| m.get(knob).ok());
                if let Some(value) = value {
                    let _ = connection.emit_signal(
                        None::<&str>,
                        OBJECT_PATH,
                        INTERFACE,
                        "Changed",
                        &(knob, value.variant()),
                    );
                }
            }
        }
    });
}
