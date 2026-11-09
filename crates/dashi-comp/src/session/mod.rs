//! The session around the compositor: its client (`-c`). C3 adds the lock,
//! idle, power, and the agent seat.

pub(crate) mod agent;
mod agent_keys;
pub(crate) mod applets;
mod child;
pub(crate) mod idle;
pub(crate) mod lock;
// Agents (0.4.0, secrets): whose presses were whose.
pub(crate) mod origin;
pub(crate) mod trust;

pub(crate) use child::{end_session, spawn};
