//! What the host says about the SMU: lockdown, the core count, and which SMN
//! backend to drive.

use super::smn::{PciSmn, SimSmu, Smn};
use crate::sysfs::Sysfs;

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
