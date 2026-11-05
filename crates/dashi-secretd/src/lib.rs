//! dashi-secretd: Dashi's vault, a store whose secrets agents can use (to
//! sign in, enter a code) but never read. It runs as its own system user, so
//! no process of yours can read its file or its memory, and it refuses every
//! caller in an agent's cgroup. docs/secrets.md is its design.

pub mod bridge;
pub mod caller;
pub mod client;
pub mod daemon;
pub mod fido;
pub mod import;
pub mod server;
pub mod totp;
pub mod tpm;
pub mod vault;

/// Where the daemon listens.
pub const SOCKET: &str = "/run/dashi-secretd/socket";
/// Where vaults are kept (the daemon's StateDirectory).
pub const STATE: &str = "/var/lib/dashi-secretd";
