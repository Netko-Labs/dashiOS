//! dashi-voice: Dashi's voice (docs/voice.md). It hears what the person
//! says while the shell asks it to (Silero VAD, Parakeet, Whisper) and says
//! what the shell gives it (Kokoro), all on this machine: `serve` is the
//! session's service on a socket; the other subcommands run the same models
//! on WAV files and manage the models.

mod audio;
mod caller;
mod cli;
mod engine;
mod hub;
mod models;
mod paths;
mod protocol;
mod server;
mod service;
mod text;

use std::process::ExitCode;

fn main() -> ExitCode {
    cli::main()
}
