//! The poll thread behind the `Changed` signal.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use super::{INTERFACE, OBJECT_PATH, Shared};

/// Poll the sysfs files the knobs live in (platform_profile notifies, Fn F5
/// and Fn F4 raise the `*_hw_changed` markers); emit `Changed` for a knob
/// whose files moved, by Dashi or anything else. Contents are compared as
/// read.
pub(crate) fn spawn_poll(connection: zbus::blocking::Connection, shared: Arc<Shared>) {
    std::thread::spawn(move || {
        let watched = shared
            .machine
            .lock()
            .map(|m| m.watched_files())
            .unwrap_or_default();
        let mut seen: HashMap<String, Option<String>> = HashMap::new();
        let mut first_pass = true;
        loop {
            std::thread::sleep(Duration::from_millis(700));
            let mut touched: Vec<&'static str> = Vec::new();
            {
                let machine = match shared.machine.lock() {
                    Ok(machine) => machine,
                    Err(_) => continue,
                };
                for (file, knob) in &watched {
                    let now = machine.sysfs.read(file);
                    if seen.get(file) != Some(&now) {
                        seen.insert(file.clone(), now);
                        if !first_pass && !touched.contains(knob) {
                            touched.push(knob);
                        }
                    }
                }
            }
            first_pass = false;
            for knob in touched {
                let value = shared.machine.lock().ok().and_then(|m| m.get(knob).ok());
                if let Some(value) = value {
                    let _ = connection.emit_signal(
                        None::<&str>,
                        OBJECT_PATH,
                        INTERFACE,
                        "Changed",
                        &(knob, value.variant()),
                    );
                }
            }
        }
    });
}
