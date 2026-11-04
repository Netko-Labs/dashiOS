//! Variable refresh rate as the shell chooses it per screen (`outputs-config`
//! `vrr`); the udev backend carries it out (backend/udev/vrr.rs).

use smithay::output::Output;

use crate::state::Dashi;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum VrrMode {
    #[default]
    Off,
    On,
    /// Only while a window is full screen on that screen (games, video).
    Fullscreen,
}

impl VrrMode {
    pub(crate) fn parse(name: &str) -> Option<Self> {
        match name {
            "off" => Some(Self::Off),
            "on" => Some(Self::On),
            "fullscreen" => Some(Self::Fullscreen),
            _ => None,
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::On => "on",
            Self::Fullscreen => "fullscreen",
        }
    }
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
        for mode in [VrrMode::Off, VrrMode::On, VrrMode::Fullscreen] {
            assert_eq!(VrrMode::parse(mode.name()), Some(mode));
        }
        assert_eq!(VrrMode::parse("adaptive"), None);
    }
}
