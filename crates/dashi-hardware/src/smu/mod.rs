//! The Curve Optimizer: AMD's SMU, reached the way RyzenAdj does (the PCI
//! root complex's SMN registers), with the encoding and mailbox sequence in
//! the submodules. SMU writes never run on this host: the real backend is
//! only built here, and the tests drive the simulated SMU
//! (docs/hardware.md, "The Curve Optimizer").

mod cpuid;
mod encode;
mod mailbox;
mod smn;

use serde_json::{Value, json};

use crate::model::Model;
use crate::sysfs::Sysfs;

pub(crate) use encode::{OFFSET_MAX, OFFSET_MIN};
pub(crate) use smn::SimSmu;

use mailbox::Mp1;
use smn::{PciSmn, Smn};

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

/// Whether the kernel is in a lockdown mode that blocks the PCI writes.
pub(crate) fn kernel_lockdown(sysfs: &Sysfs) -> bool {
    // "[none] integrity confidentiality": the one in brackets is active.
    match sysfs.read("kernel/security/lockdown") {
        Some(line) => !line.contains("[none]"),
        None => false,
    }
}

/// The number of physical cores (distinct `core_id`s), for per-core limits.
pub(crate) fn core_count(sysfs: &Sysfs) -> u32 {
    use std::collections::BTreeSet;
    let ids: BTreeSet<String> = crate::knobs::cpu_names(sysfs)
        .iter()
        .filter_map(|cpu| sysfs.read(&format!("devices/system/cpu/{cpu}/topology/core_id")))
        .collect();
    u32::try_from(ids.len()).unwrap_or(0)
}

/// The backend for this tree: the real SMU, or a simulated one for a fake
/// tree (where the model says this is Strix Point-like).
pub(crate) fn make_smn(sysfs: &Sysfs) -> Box<dyn Smn> {
    if sysfs.is_fake() {
        Box::new(SimSmu::new())
    } else {
        Box::new(PciSmn::new(sysfs.root()))
    }
}

/// The `CurveOptimizer()` method's JSON (docs/hardware.md).
pub(crate) fn describe(
    sysfs: &Sysfs,
    model: Option<&Model>,
    all_core: i32,
    per_core_values: &[i32],
) -> Value {
    match CurveOptimizer::probe(sysfs, model, make_smn(sysfs)) {
        Ok((_, cap)) => json!({
            "available": true,
            "reason": "",
            "range": [cap.range.0, cap.range.1],
            "perCore": cap.per_core,
            "cores": cap.cores,
            "allCore": all_core,
            "perCoreValues": per_core_values,
        }),
        Err(reason) => json!({
            "available": false,
            "reason": reason.reason(),
            "range": [0, 0],
            "perCore": false,
            "cores": 0,
            "allCore": 0,
            "perCoreValues": [],
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sysfs::testing::TempTree;

    fn g14_model() -> Model {
        Model::parse(include_str!("../../../../data/models/GA403WR.json")).expect("parses")
    }

    fn sim() -> Box<dyn Smn> {
        Box::new(SimSmu::new())
    }

    #[test]
    fn available_on_the_simulated_g14_and_offsets_land() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        let model = g14_model();
        let (mut co, cap) = match CurveOptimizer::probe(&sysfs, Some(&model), sim()) {
            Ok(result) => result,
            // CPUID on the build host may not be Strix Point.
            Err(Unavailable::UnsupportedCpu) => return,
            Err(other) => panic!("unexpected: {other:?}"),
        };
        assert_eq!(cap.range, (-40, 0));
        assert!(cap.per_core);
        assert!(co.set_all_core(-5).is_ok());
        assert!(co.set_per_core(0, -10).is_ok());
        assert!(co.set_per_core(999, -5).is_err());
    }

    #[test]
    fn lockdown_blocks_it() {
        let tree = TempTree::fixture("ga403wr");
        tree.file(
            "kernel/security/lockdown",
            "none [integrity] confidentiality",
        );
        let sysfs = Sysfs::fake(&tree.path);
        assert!(kernel_lockdown(&sysfs));
        let result = CurveOptimizer::probe(&sysfs, Some(&g14_model()), sim());
        assert!(matches!(
            result,
            Err(Unavailable::Lockdown) | Err(Unavailable::UnsupportedCpu)
        ));
    }

    #[test]
    fn a_model_without_undervolt_is_not_in_the_database() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        let model =
            Model::parse(r#"{"id":"X","name":"X","match":{"board_name":"GA403WR"}}"#).unwrap();
        assert_eq!(
            CurveOptimizer::probe(&sysfs, Some(&model), sim()).err(),
            Some(Unavailable::NotInDatabase)
        );
    }

    #[test]
    fn describe_is_unavailable_without_a_model() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        let value = describe(&sysfs, None, 0, &[]);
        assert_eq!(value["available"], json!(false));
        assert_eq!(value["reason"], json!("not-in-database"));
    }

    #[test]
    fn the_core_count_is_read_from_topology() {
        let tree = TempTree::fixture("ga403wr");
        let sysfs = Sysfs::fake(&tree.path);
        // The G14's HX 370 has 12 physical cores (24 threads).
        assert_eq!(core_count(&sysfs), 12);
    }
}
