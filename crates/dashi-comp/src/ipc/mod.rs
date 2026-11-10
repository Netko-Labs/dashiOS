//! IPC with the shell: docs/compositor-ipc.md.

#[cfg(test)]
mod fixtures;
mod frame;
mod grants;
mod incoming;
pub(crate) mod methods;
mod peer;
pub(crate) mod protocol;
mod server;
mod table;

pub(crate) use server::Ipc;
