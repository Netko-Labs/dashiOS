//! Saved tuning, the boot guard and the Slash bar's settings
//! (`/var/lib/dashi-hardware/`, docs/hardware.md). Tuning that can freeze
//! the machine is applied only after a clean boot and kept only once
//! confirmed; two failed boots in a row clear it.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::slash::Settings as SlashSettings;
use crate::sysfs::Sysfs;

/// The real state directory.
pub(crate) const STATE_DIR: &str = "/var/lib/dashi-hardware";

/// The tuning values that survive a reboot (the SMU and the firmware forget
/// theirs). `Set`/`SetMany` of these knobs don't save on their own; the
/// values are saved by `ConfirmTuning` once a countdown is survived.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub(crate) struct SavedTuning {
    /// Knob name → value (the power and GPU limits).
    pub(crate) knobs: BTreeMap<String, serde_json::Value>,
    /// The Curve Optimizer's all-core offset, if set.
    pub(crate) curve_all_core: Option<i32>,
    /// Per-core offsets, core index → offset.
    pub(crate) curve_per_core: BTreeMap<u32, i32>,
}

impl SavedTuning {
    pub(crate) fn is_empty(&self) -> bool {
        self.knobs.is_empty() && self.curve_all_core.is_none() && self.curve_per_core.is_empty()
    }
}

/// What `BootGuard()` reports, recorded at each boot.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootGuard {
    pub(crate) clean_boot: bool,
    pub(crate) failed_boots: u32,
    pub(crate) reset: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct StateFile {
    tuning: SavedTuning,
    /// Consecutive boots that have not reached clean shutdown.
    unclean_boots: u32,
    last_boot: BootGuard,
    /// What the helper last set the Slash bar to (it can't be read back and
    /// forgets at boot). Not tuning: the boot guard leaves it alone.
    slash: Option<SlashSettings>,
}

/// The helper's state on disk.
pub(crate) struct State {
    dir: PathBuf,
}

impl State {
    /// Where state lives for a tree: `/var/lib/dashi-hardware` for the real
    /// one, `<root>/.dashi-hardware` for a fake tree (so tests and the VM
    /// keep it beside the fixture).
    pub(crate) fn for_sysfs(sysfs: &Sysfs) -> Self {
        let dir = if sysfs.is_fake() {
            sysfs.root().join(".dashi-hardware")
        } else {
            PathBuf::from(STATE_DIR)
        };
        Self { dir }
    }

    #[cfg(test)]
    pub(crate) fn at(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn path(&self) -> PathBuf {
        self.dir.join("state.json")
    }

    fn read(&self) -> StateFile {
        fs::read_to_string(self.path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn write(&self, state: &StateFile) -> std::io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let text = serde_json::to_string_pretty(state).unwrap_or_default();
        let tmp = self.dir.join("state.json.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, self.path())
    }

    pub(crate) fn saved_tuning(&self) -> SavedTuning {
        self.read().tuning
    }

    pub(crate) fn save_tuning(&self, tuning: &SavedTuning) -> std::io::Result<()> {
        let mut state = self.read();
        state.tuning = tuning.clone();
        self.write(&state)
    }

    pub(crate) fn clear_tuning(&self) -> std::io::Result<()> {
        let mut state = self.read();
        state.tuning = SavedTuning::default();
        self.write(&state)
    }

    pub(crate) fn saved_slash(&self) -> Option<SlashSettings> {
        self.read().slash.map(SlashSettings::sanitized)
    }

    pub(crate) fn save_slash(&self, settings: &SlashSettings) -> std::io::Result<()> {
        let mut state = self.read();
        state.slash = Some(settings.clone());
        self.write(&state)
    }

    pub(crate) fn last_boot(&self) -> BootGuard {
        self.read().last_boot
    }

    /// `dashi-hardware-boot.service`, early at boot: this boot is unclean
    /// until the clean unit runs. If the previous boot never cleaned, that
    /// was a failed boot; two in a row clear the saved tuning.
    pub(crate) fn on_boot(&self) -> std::io::Result<BootGuard> {
        let mut state = self.read();
        let failed_boots = state.unclean_boots;
        let clean_boot = failed_boots == 0;
        state.unclean_boots = failed_boots.saturating_add(1);
        let reset = state.unclean_boots >= 2 && !state.tuning.is_empty();
        if reset {
            state.tuning = SavedTuning::default();
        }
        let guard = BootGuard {
            clean_boot,
            failed_boots,
            reset,
        };
        state.last_boot = guard;
        self.write(&state)?;
        Ok(guard)
    }

    /// `dashi-hardware-clean.service`, ordered at shutdown: this boot reached
    /// a clean shutdown, so the counter goes back to zero.
    pub(crate) fn on_clean(&self) -> std::io::Result<()> {
        let mut state = self.read();
        state.unclean_boots = 0;
        self.write(&state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sysfs::testing::TempTree;

    fn state() -> (TempTree, State) {
        let tree = TempTree::empty();
        let state = State::at(tree.path.join("state"));
        (tree, state)
    }

    #[test]
    fn a_clean_boot_keeps_the_tuning() {
        let (_t, state) = state();
        let tuning = SavedTuning {
            curve_all_core: Some(-5),
            ..SavedTuning::default()
        };
        state.save_tuning(&tuning).unwrap();

        let guard = state.on_boot().unwrap();
        assert_eq!(
            guard,
            BootGuard {
                clean_boot: true,
                failed_boots: 0,
                reset: false
            }
        );
        state.on_clean().unwrap();
        // Next boot is clean again, the tuning is still there.
        let guard = state.on_boot().unwrap();
        assert!(guard.clean_boot);
        assert_eq!(state.saved_tuning().curve_all_core, Some(-5));
    }

    #[test]
    fn two_failed_boots_in_a_row_reset() {
        let (_t, state) = state();
        state
            .save_tuning(&SavedTuning {
                curve_all_core: Some(-5),
                ..SavedTuning::default()
            })
            .unwrap();

        // First boot: no clean shutdown follows.
        let first = state.on_boot().unwrap();
        assert_eq!(first.failed_boots, 0);
        assert!(!first.reset);
        // Second boot without a clean in between: two failed in a row.
        let second = state.on_boot().unwrap();
        assert_eq!(second.failed_boots, 1);
        assert!(!second.clean_boot);
        assert!(second.reset);
        assert!(state.saved_tuning().is_empty());
        assert_eq!(state.last_boot(), second);
    }

    #[test]
    fn reset_is_not_flagged_when_there_was_nothing_saved() {
        let (_t, state) = state();
        state.on_boot().unwrap();
        let second = state.on_boot().unwrap();
        assert!(!second.reset, "no tuning to lose");
    }
}
