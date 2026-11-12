//! The Curve Optimizer itself: what the machine allows (`probe`) and the
//! offsets it takes, over an SMN backend.

use super::cpuid;
use super::encode::{OFFSET_MAX, OFFSET_MIN};
use super::host::{core_count, kernel_lockdown};
use super::mailbox::{self, Mp1};
use super::smn::Smn;
use crate::model::Model;
use crate::sysfs::Sysfs;

/// Why the Curve Optimizer is unavailable, if it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Unavailable {
    UnsupportedCpu,
    Lockdown,
    Rejected,
    NotInDatabase,
}

impl Unavailable {
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Unavailable::UnsupportedCpu => "unsupported-cpu",
            Unavailable::Lockdown => "lockdown",
            Unavailable::Rejected => "rejected",
            Unavailable::NotInDatabase => "not-in-database",
        }
    }
}

/// What the Curve Optimizer can do on this machine.
#[derive(Clone, Debug)]
pub(crate) struct Capability {
    /// The offset range, from the model, clamped to the 20-bit encoding.
    pub(crate) range: (i32, i32),
    pub(crate) per_core: bool,
    pub(crate) cores: u32,
}

/// The Curve Optimizer, over an SMN backend (the real root complex, or a
/// simulated SMU for `--sysfs-root` and tests).
pub(crate) struct CurveOptimizer {
    smn: Box<dyn Smn>,
    mp1: Mp1,
    cores: u32,
}

impl CurveOptimizer {
    /// Decide what the machine allows, and open the SMU if it does. `smn` is
    /// the backend to drive; it is only touched once every cheaper check has
    /// passed, so on the real host nothing reaches PCI unless the CPU is
    /// known, the database has a range, and lockdown is off.
    pub(crate) fn probe(
        sysfs: &Sysfs,
        model: Option<&Model>,
        smn: Box<dyn Smn>,
    ) -> Result<(CurveOptimizer, Capability), Unavailable> {
        let undervolt = model
            .and_then(|m| m.undervolt.as_ref())
            .ok_or(Unavailable::NotInDatabase)?;
        let family = cpuid::detect_family().ok_or(Unavailable::UnsupportedCpu)?;
        let mp1 = mailbox::for_family(family).ok_or(Unavailable::UnsupportedCpu)?;
        if kernel_lockdown(sysfs) {
            return Err(Unavailable::Lockdown);
        }
        let mut co = CurveOptimizer {
            smn,
            mp1,
            cores: core_count(sysfs),
        };
        // The bus must take writes (Secure Boot's lockdown blocks them even
        // when the lockdown file reads "none"), and a write of 0 must stick.
        if !mailbox::writable(co.smn.as_mut(), &mp1).unwrap_or(false) {
            return Err(Unavailable::Lockdown);
        }
        if mailbox::set_all_core(co.smn.as_mut(), &mp1, 0).is_err() {
            return Err(Unavailable::Rejected);
        }
        let range = (
            undervolt.cpu[0].clamp(OFFSET_MIN, OFFSET_MAX),
            undervolt.cpu[1].clamp(OFFSET_MIN, OFFSET_MAX),
        );
        let capability = Capability {
            range,
            per_core: undervolt.per_core,
            cores: co.cores,
        };
        Ok((co, capability))
    }

    pub(crate) fn set_all_core(&mut self, offset: i32) -> Result<(), String> {
        mailbox::set_all_core(self.smn.as_mut(), &self.mp1, offset)
    }

    pub(crate) fn set_per_core(&mut self, core: u32, offset: i32) -> Result<(), String> {
        if core >= self.cores {
            return Err(format!("core {core} is out of range (0..{})", self.cores));
        }
        mailbox::set_per_core(self.smn.as_mut(), &self.mp1, core, offset)
    }
}
