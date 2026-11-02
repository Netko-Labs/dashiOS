//! The session around the compositor: its client (`-c`). C3 adds the lock,
//! idle, power, and the agent seat.

mod child;
pub(crate) mod idle;
pub(crate) mod trust;

pub(crate) use child::spawn;
