//! IPC with the shell: docs/compositor-ipc.md.

mod frame;
mod grants;
mod methods;
mod params;
mod peer;
mod server;
mod table;

pub(crate) use server::Ipc;
