//! Variable refresh rate as the shell chooses it per screen (`outputs-config`
//! `vrr`); the udev backend carries it out (backend/udev/vrr.rs).

use serde::{Deserialize, Serialize};
use smithay::output::Output;

use crate::state::Dashi;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VrrMode {
    #[default]
    Off,
    On,
    /// Only while a window is full screen on that screen (games, video).
    Fullscreen,
}

impl Dashi {
    pub(crate) fn vrr_mode(&self, output: &Output) -> VrrMode {
        self.vrr_modes
            .get(&output.name())
            .copied()
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_by_name() {
        for (mode, name) in [
            (VrrMode::Off, "off"),
            (VrrMode::On, "on"),
            (VrrMode::Fullscreen, "fullscreen"),
        ] {
            assert_eq!(serde_json::to_value(mode).unwrap(), serde_json::json!(name));
            assert_eq!(
                serde_json::from_value::<VrrMode>(serde_json::json!(name)).unwrap(),
                mode
            );
        }
        assert!(serde_json::from_value::<VrrMode>(serde_json::json!("adaptive")).is_err());
    }
}
