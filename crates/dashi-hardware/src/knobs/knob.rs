//! The knobs a machine can have, their names, value kinds and the polkit
//! action that guards each.

use super::value::Kind;

/// Every knob, in the order `SetMany` writes them: the platform profile
/// first (on ASUS it resets the power limits), the limits after it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Knob {
    PlatformProfile,
    Epp,
    Boost,
    CpuMaxFreq,
    PptSpl,
    PptSppt,
    PptFppt,
    NvTgp,
    NvDynamicBoost,
    NvTempTarget,
    ChargeLimit,
    KbdBacklight,
    PanelOverdrive,
    GpuMux,
}

/// The polkit action a change needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Action {
    Everyday,
    Tune,
}

impl Action {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Action::Everyday => "dev.dashi.hardware.everyday",
            Action::Tune => "dev.dashi.hardware.tune",
        }
    }
}

impl Knob {
    pub(crate) const ALL: [Knob; 14] = [
        Knob::PlatformProfile,
        Knob::Epp,
        Knob::Boost,
        Knob::CpuMaxFreq,
        Knob::PptSpl,
        Knob::PptSppt,
        Knob::PptFppt,
        Knob::NvTgp,
        Knob::NvDynamicBoost,
        Knob::NvTempTarget,
        Knob::ChargeLimit,
        Knob::KbdBacklight,
        Knob::PanelOverdrive,
        Knob::GpuMux,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Knob::PlatformProfile => "platform-profile",
            Knob::Epp => "epp",
            Knob::Boost => "boost",
            Knob::CpuMaxFreq => "cpu-max-freq",
            Knob::PptSpl => "ppt-spl",
            Knob::PptSppt => "ppt-sppt",
            Knob::PptFppt => "ppt-fppt",
            Knob::NvTgp => "nv-tgp",
            Knob::NvDynamicBoost => "nv-dynamic-boost",
            Knob::NvTempTarget => "nv-temp-target",
            Knob::ChargeLimit => "charge-limit",
            Knob::KbdBacklight => "kbd-backlight",
            Knob::PanelOverdrive => "panel-overdrive",
            Knob::GpuMux => "gpu-mux",
        }
    }

    pub(crate) fn from_name(name: &str) -> Option<Knob> {
        Knob::ALL.into_iter().find(|knob| knob.name() == name)
    }

    pub(crate) fn kind(self) -> Kind {
        match self {
            Knob::PlatformProfile | Knob::Epp => Kind::Str,
            Knob::Boost | Knob::PanelOverdrive => Kind::Bool,
            _ => Kind::U32,
        }
    }

    pub(crate) fn action(self) -> Action {
        match self {
            Knob::PptSpl
            | Knob::PptSppt
            | Knob::PptFppt
            | Knob::NvTgp
            | Knob::NvDynamicBoost
            | Knob::NvTempTarget
            | Knob::GpuMux => Action::Tune,
            _ => Action::Everyday,
        }
    }
}
