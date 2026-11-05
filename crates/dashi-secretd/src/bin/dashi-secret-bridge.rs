//! dashi-secret-bridge: org.freedesktop.secrets and the portal's Secret
//! backend on the session bus, backed by dashi-secretd. Started with the
//! session (dashi-secret-bridge.service, a user unit) or by D-Bus activation.
//!
//!   dashi-secret-bridge [--socket PATH]

use std::{path::PathBuf, sync::Arc};

use dashi_secretd::{
    SOCKET,
    bridge::{SERVICE_PATH, Shared, objects, portal, service::Service},
};

fn main() {
    // SAFETY: prctl with PR_SET_DUMPABLE takes an integer and touches no memory.
    // Not dumpable: no core file, and no ptrace by other processes of this user.
    unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0) };
    let mut socket = PathBuf::from(SOCKET);
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match (arg.as_str(), args.next()) {
            ("--socket", Some(path)) => socket = PathBuf::from(path),
            _ => {
                eprintln!("usage: dashi-secret-bridge [--socket PATH]");
                std::process::exit(2);
            }
        }
    }
    let shared = Arc::new(Shared::new(socket));
    let built = zbus::blocking::connection::Builder::session()
        .and_then(|b| {
            b.serve_at(
                SERVICE_PATH,
                Service {
                    shared: shared.clone(),
                },
            )
        })
        .and_then(|b| {
            b.serve_at(
                portal::PATH,
                portal::Portal {
                    shared: shared.clone(),
                },
            )
        })
        .and_then(|b| b.name("org.freedesktop.secrets"))
        .and_then(|b| b.name(portal::NAME))
        .and_then(|b| b.build());
    let connection = match built {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("dashi-secret-bridge: can't take the Secret Service's name: {error}");
            std::process::exit(1);
        }
    };
    let server = connection.object_server();
    let inner = server.inner();
    if let Err(error) = zbus::block_on(objects::sync(inner, &shared)) {
        eprintln!("dashi-secret-bridge: {error} (the vault may still be locked)");
    }
    eprintln!("dashi-secret-bridge: serving the Secret Service");
    loop {
        std::thread::park();
    }
}
