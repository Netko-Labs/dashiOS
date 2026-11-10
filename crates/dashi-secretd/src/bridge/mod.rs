//! dashi-secret-bridge: the Secret Service (org.freedesktop.secrets) and the
//! portal's Secret backend on the session bus, for apps, backed by
//! dashi-secretd. It runs as you, in its own user unit, and checks every
//! caller: one in an agent's cgroup is refused, as dashi-secretd would.

pub mod collection;
pub mod item;
pub mod objects;
pub mod peer;
pub mod portal;
pub mod service;
pub mod session;
mod session_object;
mod shared;
mod wire;

pub use shared::{PREFIX, SERVICE_PATH, Shared, no_such_object};
