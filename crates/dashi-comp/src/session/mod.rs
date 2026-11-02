//! The session around the compositor: its client (`-c`). C3 adds the lock,
//! idle, power, and the agent seat.

pub(crate) mod agent;
mod child;
pub(crate) mod idle;
pub(crate) mod lock;
pub(crate) mod trust;

pub(crate) use child::spawn;
