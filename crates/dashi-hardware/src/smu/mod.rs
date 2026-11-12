//! The Curve Optimizer: AMD's SMU, reached the way RyzenAdj does (the PCI
//! root complex's SMN registers), with the encoding and mailbox sequence in
//! the submodules. SMU writes never run on this host: the real backend is
//! only built here, and the tests drive the simulated SMU
//! (docs/hardware.md, "The Curve Optimizer").

mod cpuid;
mod describe;
mod encode;
mod host;
mod mailbox;
mod optimizer;
mod smn;
#[cfg(test)]
mod tests;

pub(crate) use describe::describe;
pub(crate) use host::{core_count, make_smn};
pub(crate) use optimizer::CurveOptimizer;
