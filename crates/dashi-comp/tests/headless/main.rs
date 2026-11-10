//! The compositor as the shell meets it: the real binary, headless (no GPU),
//! in a runtime folder of its own.
// Tests may unwrap and touch files (H12 covers the compositor, not its tests).
#![allow(clippy::unwrap_used, clippy::disallowed_methods)]

#[path = "../support"]
mod support {
    pub mod client;
    pub mod compositor;
}

mod agent;
mod fixtures;
mod ipc;
mod pointer;
mod screens;
mod session;
mod spaces;
mod switching;
mod wallpapers;
mod windows;
