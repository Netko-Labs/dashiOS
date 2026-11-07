//! What holds a GPU open and what sysfs says of its connectors (read
//! without waking it); `gpus` describes every GPU, open or asleep. The rules
//! for when to open and let go are lifecycle.rs's; sleep.rs carries them out.

use std::{fs, path::Path};

use super::lifecycle::Holds;
use super::*;

/// Where the kernel lists DRM cards and their connectors.
pub(super) const DRM_SYSFS: &str = "/sys/class/drm";

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
                        "answering": true,
                    }),
                ))
            })
            .collect();
        gpus.extend(
            self.cards
                .iter()
                .filter(|(node, _)| !self.devices.contains_key(node))
                .map(|(_, card)| {
                    (
                        card.name.clone(),
                        json!({
                            "card": card.name,
                            "open": false,
                            "draws": false,
                            "kept": self.kept.contains(&card.name),
                            "screens": [],
                            "buffers": 0,
                            "answering": card.life.answers(),
                        }),
                    )
                }),
        );
        gpus.sort_by(|a, b| a.0.cmp(&b.0));
        json!({ "gpus": gpus.into_iter().map(|(_, gpu)| gpu).collect::<Vec<_>>() })
    }

    /// The GPU udev calls `card`, open or asleep.
    pub(super) fn node_of(&self, card: &str) -> Option<DrmNode> {
        self.cards
            .iter()
            .find(|(_, each)| each.name == card)
            .map(|(node, _)| *node)
            .or_else(|| {
                self.devices
                    .iter()
                    .find(|(_, device)| device.card == card)
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
