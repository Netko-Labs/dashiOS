//! What holds a GPU that does not draw open (sleep.rs lets it go when
//! nothing does), what a sleeping one is, and the sysfs and timing rules for
//! when to open it again; `gpus` describes them all.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use super::*;

/// How long a GPU nothing needs stays open: a cable pulled and pushed back, a monitor's power cycle.
pub(super) const GRACE: Duration = Duration::from_secs(10);
/// A change event on a GPU asleep, with sysfs saying nothing is connected,
/// opens it to look, unless it went to sleep this recently (its own suspend
/// or resume may raise one, and looking would wake it for nothing).
const QUIET_AFTER_SLEEP: Duration = Duration::from_secs(30);
/// After a client buffer no GPU could read, even with the sleeping ones woken: how long before waking them for one again.
const BUFFER_RETRY: Duration = Duration::from_secs(30);
/// Where the kernel lists DRM cards and their connectors.
pub(super) const DRM_SYSFS: &str = "/sys/class/drm";

/// A GPU let go: what it takes to open it again.
pub(super) struct Asleep {
    pub(super) path: PathBuf,
    pub(super) card: String,
    /// When it went to sleep; None when it was never opened.
    pub(super) since: Option<Instant>,
}

/// What holds a GPU that does not draw open.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct Holds {
    /// Screens connected to it.
    screens: usize,
    /// Client buffers only it could read, still alive.
    buffers: usize,
    /// The shell keeps it warm (`gpu-keep`).
    kept: bool,
}

/// What to do with a GPU nothing may need, at the end of its grace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Next {
    /// A screen or the shell holds it: nothing to wait for.
    Stay,
    /// Only client buffers hold it: look again after another grace.
    Wait,
    /// Nothing holds it: let it go.
    Sleep,
}

impl Holds {
    pub(super) fn next(self) -> Next {
        if self.screens > 0 || self.kept {
            Next::Stay
        } else if self.buffers > 0 {
            Next::Wait
        } else {
            Next::Sleep
        }
    }
}

/// Whether a change event on a sleeping GPU should open it: sysfs says a
/// screen is connected, or it has slept long enough that looking is cheap.
pub(super) fn look_on_change(connected: bool, asleep_for: Option<Duration>) -> bool {
    connected || asleep_for.is_none_or(|slept| slept >= QUIET_AFTER_SLEEP)
}

/// Whether to wake sleeping GPUs for a buffer the open ones cannot read.
pub(super) fn may_wake_for_buffer(since_failed: Option<Duration>) -> bool {
    since_failed.is_none_or(|since| since >= BUFFER_RETRY)
}

/// `card0` from `/dev/dri/card0`.
pub(super) fn card_name(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    name.starts_with("card").then(|| name.to_owned())
}

/// What sysfs says of a card's connectors (`<drm>/card0-HDMI-A-1/status`):
/// the kernel's last probe, read without probing again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Sysfs {
    /// A screen is connected.
    Connected,
    /// No screen is, as far as it knows, but a connector was never probed
    /// (`unknown`), or sysfs could not be read: open the card to look.
    Unprobed,
    /// Every connector is disconnected, or it has none.
    Disconnected,
}

pub(super) fn sysfs_screens(drm: &Path, card: &str) -> Sysfs {
    let prefix = format!("{card}-");
    let Ok(entries) = fs::read_dir(drm) else {
        return Sysfs::Unprobed;
    };
    let mut seen = Sysfs::Disconnected;
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(&prefix))
        {
            continue;
        }
        match fs::read_to_string(entry.path().join("status"))
            .as_deref()
            .map(str::trim)
        {
            Ok("connected") => return Sysfs::Connected,
            Ok("disconnected") => {}
            _ => seen = Sysfs::Unprobed,
        }
    }
    seen
}

impl UdevData {
    /// What holds an open GPU, forgetting the client buffers that are gone.
    pub(super) fn holds(&mut self, node: DrmNode) -> Option<Holds> {
        let device = self.devices.get_mut(&node)?;
        device.buffers.retain(|buffer| !buffer.is_gone());
        Some(Holds {
            screens: device.screens.len(),
            buffers: device.buffers.len(),
            kept: self.kept.contains(&device.card),
        })
    }

    /// `gpus`: each GPU, open or asleep, and what holds it.
    pub(crate) fn describe_gpus(&mut self) -> Value {
        let primary = self.primary_gpu;
        let nodes: Vec<DrmNode> = self.devices.keys().copied().collect();
        let mut gpus: Vec<(String, Value)> = nodes
            .into_iter()
            .filter_map(|node| {
                let holds = self.holds(node)?;
                let device = self.devices.get(&node)?;
                let screens: Vec<String> =
                    device.screens.values().map(|s| s.output.name()).collect();
                Some((
                    device.card.clone(),
                    json!({
                        "card": device.card,
                        "open": true,
                        "draws": is_drawing_gpu(node, primary),
                        "kept": holds.kept,
                        "screens": screens,
                        "buffers": holds.buffers,
                    }),
                ))
            })
            .collect();
        gpus.extend(self.asleep.values().map(|asleep| {
            (
                asleep.card.clone(),
                json!({
                    "card": asleep.card,
                    "open": false,
                    "draws": false,
                    "kept": self.kept.contains(&asleep.card),
                    "screens": [],
                    "buffers": 0,
                }),
            )
        }));
        gpus.sort_by(|a, b| a.0.cmp(&b.0));
        json!({ "gpus": gpus.into_iter().map(|(_, gpu)| gpu).collect::<Vec<_>>() })
    }

    /// The GPU udev calls `card`, open or asleep.
    pub(super) fn node_of(&self, card: &str) -> Option<DrmNode> {
        self.devices
            .iter()
            .find(|(_, device)| device.card == card)
            .map(|(node, _)| *node)
            .or_else(|| {
                self.asleep
                    .iter()
                    .find(|(_, asleep)| asleep.card == card)
                    .map(|(node, _)| *node)
            })
    }
}

/// `gpus`: none outside a seat of our own.
pub(crate) fn describe_gpus(state: &mut Dashi) -> Value {
    with_udev(state, |_, data| data.describe_gpus()).unwrap_or_else(|| json!({ "gpus": [] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn holds(screens: usize, buffers: usize, kept: bool) -> Holds {
        Holds {
            screens,
            buffers,
            kept,
        }
    }

    #[test]
    fn a_screen_or_the_shell_holds_a_gpu_and_buffers_hold_it_while_they_live() {
        assert_eq!(holds(1, 0, false).next(), Next::Stay);
        assert_eq!(holds(0, 0, true).next(), Next::Stay);
        assert_eq!(holds(0, 2, false).next(), Next::Wait);
        assert_eq!(holds(0, 0, false).next(), Next::Sleep);
    }

    #[test]
    fn a_change_wakes_a_gpu_with_a_screen_and_looks_only_after_it_slept_a_while() {
        assert!(look_on_change(true, Some(Duration::from_secs(1))));
        assert!(!look_on_change(false, Some(Duration::from_secs(1))));
        assert!(look_on_change(false, Some(QUIET_AFTER_SLEEP)));
        assert!(look_on_change(false, None));
    }

    #[test]
    fn a_failed_wake_for_a_buffer_is_not_tried_again_at_once() {
        assert!(may_wake_for_buffer(None));
        assert!(!may_wake_for_buffer(Some(Duration::from_secs(2))));
        assert!(may_wake_for_buffer(Some(BUFFER_RETRY)));
    }

    #[test]
    fn card_names_come_from_card_nodes_only() {
        assert_eq!(
            card_name(Path::new("/dev/dri/card0")).as_deref(),
            Some("card0")
        );
        assert_eq!(card_name(Path::new("/dev/dri/renderD129")), None);
    }

    #[test]
    fn sysfs_says_which_card_has_a_screen_and_which_was_never_probed() {
        let drm = tempfile::tempdir().expect("a temporary directory");
        let connector = |name: &str, status: &str| {
            let dir = drm.path().join(name);
            fs::create_dir(&dir).expect("a connector directory");
            fs::write(dir.join("status"), format!("{status}\n")).expect("a status file");
        };
        connector("card0-HDMI-A-1", "disconnected");
        connector("card0-DP-9", "unknown");
        connector("card1-eDP-1", "connected");
        connector("card10-DP-1", "connected");
        fs::create_dir(drm.path().join("card2")).expect("a card directory");
        connector("card3-HDMI-A-2", "disconnected");
        assert_eq!(sysfs_screens(drm.path(), "card0"), Sysfs::Unprobed);
        assert_eq!(sysfs_screens(drm.path(), "card1"), Sysfs::Connected);
        assert_eq!(sysfs_screens(drm.path(), "card2"), Sysfs::Disconnected);
        assert_eq!(sysfs_screens(drm.path(), "card3"), Sysfs::Disconnected);
        assert_eq!(
            sysfs_screens(&drm.path().join("missing"), "card1"),
            Sysfs::Unprobed
        );
    }
}
