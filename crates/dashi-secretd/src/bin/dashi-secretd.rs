//! dashi-secretd: the vault service. Run by systemd as the `dashi-secret`
//! user (dashi-secretd.service, socket-activated by dashi-secretd.socket).
//!
//!   dashi-secretd [--state DIR] [--socket PATH] [--dev]
//!
//! `--dev` is for a checkout: a daemon you run as yourself, on a socket and a
//! state directory of your own, that takes the login's `unlock` from you (no
//! PAM). It is refused for the system's paths and for root, and it protects
//! nothing from your own processes: it is for trying the agent tools out.

use std::{
    os::{
        fd::FromRawFd,
        unix::{fs::PermissionsExt, net::UnixListener},
    },
    path::PathBuf,
    sync::{Arc, Mutex},
};

use dashi_secretd::{
    SOCKET, STATE,
    daemon::Daemon,
    server, tpm,
    vault::{NoTpm, Sealer, store::Store},
};

/// The listening socket systemd passed us (LISTEN_FDS), if it did.
fn activated() -> Option<UnixListener> {
    let pid: u32 = std::env::var("LISTEN_PID").ok()?.parse().ok()?;
    let fds: u32 = std::env::var("LISTEN_FDS").ok()?.parse().ok()?;
    (pid == std::process::id() && fds >= 1).then(|| {
        // SAFETY: systemd hands the first socket over as fd 3 and nothing else owns it.
        unsafe { UnixListener::from_raw_fd(3) }
    })
}

fn main() {
    // SAFETY: prctl with PR_SET_DUMPABLE takes an integer and touches no memory.
    // Not dumpable: no core file, and no ptrace by other processes of this user.
    unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0) };
    let mut state = PathBuf::from(STATE);
    let mut socket = PathBuf::from(SOCKET);
    let mut dev = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--state" => state = args.next().map(PathBuf::from).unwrap_or(state),
            "--socket" => socket = args.next().map(PathBuf::from).unwrap_or(socket),
            "--dev" => dev = true,
            _ => {
                eprintln!("usage: dashi-secretd [--state DIR] [--socket PATH] [--dev]");
                std::process::exit(2);
            }
        }
    }
    // SAFETY: getuid has no preconditions.
    let uid = unsafe { libc::getuid() };
    if dev
        && (uid == 0
            || state.as_path() == std::path::Path::new(STATE)
            || socket.as_path() == std::path::Path::new(SOCKET))
    {
        eprintln!("dashi-secretd: --dev runs as you, on your own --state and --socket only");
        std::process::exit(2);
    }
    if let Err(error) = std::fs::create_dir_all(&state) {
        eprintln!("dashi-secretd: {}: {error}", state.display());
        std::process::exit(1);
    }
    let _ = std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o700));
    let sealer: Box<dyn Sealer> = if dev {
        Box::new(NoTpm)
    } else {
        Box::new(tpm::SystemdCreds)
    };
    let mut daemon = Daemon::new(Store::new(&state), sealer);
    if dev {
        daemon = daemon.dev_pam(uid);
    }
    let listener = match activated() {
        Some(listener) => listener,
        None => {
            let _ = std::fs::remove_file(&socket);
            match UnixListener::bind(&socket) {
                Ok(listener) => {
                    // Anyone may connect; each request is checked against who sent it.
                    let mode = if dev { 0o600 } else { 0o666 };
                    let _ =
                        std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(mode));
                    listener
                }
                Err(error) => {
                    eprintln!("dashi-secretd: {}: {error}", socket.display());
                    std::process::exit(1);
                }
            }
        }
    };
    eprintln!(
        "dashi-secretd: serving {}",
        if dev { "a development vault" } else { "vaults" }
    );
    let approvals = daemon.approvals.clone();
    let daemon = Arc::new(Mutex::new(daemon));
    // The virtual security key, where /dev/uhid is ours (the udev rule gives it to dashi-secret).
    if !dev {
        let (daemon, approvals) = (daemon.clone(), approvals);
        std::thread::spawn(move || {
            if let Err(error) = dashi_secretd::fido::serve(daemon, approvals) {
                eprintln!("dashi-secretd: no security key for passkeys ({error})");
            }
        });
    }
    server::serve(listener, daemon);
}
