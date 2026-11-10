//! The Slash bar through the machine: describe it, set it, send it again.

use serde_json::{Value, json};

use super::{Machine, OpError};
use crate::slash;

impl Machine {
    /// `Slash()`'s JSON.
    pub(crate) fn slash_json(&self) -> Value {
        match &self.slash {
            Some(bar) => bar.describe(&self.sysfs, &self.state),
            None => json!({"available": false, "reason": "not-in-database"}),
        }
    }

    /// Set the bar (validated and clamped in `change`), save it, and return
    /// `Slash()`'s JSON.
    pub(crate) fn set_slash(&self, change: &slash::Change) -> Result<Value, OpError> {
        let bar = self
            .slash
            .as_ref()
            .ok_or_else(|| OpError::NoDevice("this machine has no Slash bar".into()))?;
        bar.set(&self.sysfs, &self.state, change)
            .map_err(|e| match e {
                slash::SlashError::NoDevice => OpError::NoDevice(e.to_string()),
                slash::SlashError::Io(_) => OpError::Io(e.to_string()),
            })?;
        Ok(self.slash_json())
    }

    /// Send the saved Slash settings again; whether anything was sent.
    pub(crate) fn restore_slash(&self) -> bool {
        let Some(bar) = &self.slash else {
            return false;
        };
        match bar.restore(&self.sysfs, &self.state) {
            Ok(sent) => sent,
            Err(e) => {
                eprintln!("dashi-hardware: {e}");
                false
            }
        }
    }
}
