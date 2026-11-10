//! The daemon's state and who may do what. Every request is checked here
//! before it touches a vault:
//!
//! - anything from an agent's cgroup (`dashi-agent-*`) is refused, whatever it asks;
//! - `unlock` and `lock` (the login password, the session's end) come from root (PAM) only;
//! - everything else reaches the caller's own vault, by its uid, and nobody else's;
//! - a vault is made only at login (PAM), never by a process that merely runs as you;
//! - wrong passwords are slowed down.

mod handle;
mod login;
pub mod logins;
mod pay;
pub mod payments;
pub mod protocol;
pub mod reply;
pub mod secret_service;
mod state;
mod throttle;
pub mod tokens;

pub use state::{Daemon, now};

#[cfg(test)]
mod tests;
