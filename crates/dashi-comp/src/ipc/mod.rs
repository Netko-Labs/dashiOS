//! IPC with the shell: docs/compositor-ipc.md.

mod frame;
mod requests;
mod server;

pub(crate) use server::Ipc;
