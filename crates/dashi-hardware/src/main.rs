//! dashi-hardware: Dashi's privileged hardware helper (docs/hardware.md).
//! `serve` runs the system-bus service; the other subcommands are the CLI
//! for testing on real hardware and against a `--sysfs-root` fake tree.

mod cli;
mod fans;
mod knobs;
mod machine;
mod model;
mod serve;
mod smu;
mod state;
mod sysfs;

use std::process::ExitCode;

fn main() -> ExitCode {
    let args = match cli::parse(std::env::args()) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("dashi-hardware: {message}");
            return ExitCode::from(2);
        }
    };
    if args.command.first().map(String::as_str) == Some("serve") {
        return serve::run(&args);
    }
    cli::run(&args)
}
