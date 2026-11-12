//! What each request does, by area; `table.rs` says which runs and who may ask.

pub(crate) mod agents;
pub(crate) mod capture;
pub(crate) mod chrome;
pub(crate) mod screens;
pub(crate) mod spaces;
pub(crate) mod windows;

pub(crate) use super::table::{Ask, done};
