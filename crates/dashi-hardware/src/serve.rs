//! The system-bus service: `dev.dashi.Hardware1` on the system bus, D-Bus
//! activated, a polkit action per method (docs/hardware.md). It carries out
//! what it is asked, clamped; it decides no policy. `Changed` is emitted from
//! a thread that polls the sysfs files the knobs live in.

mod countdown;
mod interface;
mod polkit;

use std::collections::HashMap;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use zbus::blocking::connection;

use crate::cli::Args;
use crate::machine::Machine;

pub(crate) const BUS_NAME: &str = "dev.dashi.Hardware1";
pub(crate) const OBJECT_PATH: &str = "/dev/dashi/Hardware1";
pub(crate) const INTERFACE: &str = "dev.dashi.Hardware1";

/// A Curve Optimizer change waiting for `ConfirmTuning`; reverted to 0 when
/// the countdown runs out first.
pub(crate) struct Pending {
    pub(crate) all_core: Option<i32>,
    pub(crate) per_core: Vec<(u32, i32)>,
}

/// State the service shares between its methods, the poll thread and the
/// countdown threads.
pub(crate) struct Shared {
    pub(crate) machine: Mutex<Machine>,
    pub(crate) pending: Mutex<HashMap<String, Pending>>,
}

pub(crate) fn run(args: &Args) -> ExitCode {
    let sysfs = args.sysfs();
    let fake = sysfs.is_fake();
    let machine = Machine::open(sysfs, &args.models_dir());
    // The Slash bar forgot at boot: send what was set last (the shell's
    // ApplySavedTuning at login and after waking sends it again too).
    machine.restore_slash();
    let shared = Arc::new(Shared {
        machine: Mutex::new(machine),
        pending: Mutex::new(HashMap::new()),
    });

    let service = interface::Hardware1::new(Arc::clone(&shared));
    let builder = if fake {
        // A fake tree can't own a system-bus name; use the session bus so the
        // VM and a developer can drive it without root.
        connection::Builder::session()
    } else {
        connection::Builder::system()
    };
    let connection = match builder
        .and_then(|b| b.name(BUS_NAME))
        .and_then(|b| b.serve_at(OBJECT_PATH, service))
        .and_then(connection::Builder::build)
    {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("dashi-hardware: couldn't take {BUS_NAME}: {error}");
            return ExitCode::FAILURE;
        }
    };

    interface::spawn_poll(connection.clone(), Arc::clone(&shared));
    eprintln!("dashi-hardware: serving {BUS_NAME}");
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}
