//! dashi-comp: Dashi's Wayland compositor. It displays and routes input; the
//! shell decides (docs/conventions.md, "The Rule"; docs/compositor.md).

mod backend;
mod background;
mod cli;
mod handlers;
mod input;
mod ipc;
mod keys;
mod outputs;
mod protocols;
mod render;
mod session;
mod state;
mod wallpaper;
mod wm;
mod xwayland;

use std::path::PathBuf;

use calloop::signals::{Signal, Signals};
use smithay::reexports::{calloop::EventLoop, wayland_server::Display};

use cli::{BackendChoice, Parsed};
use ipc::Ipc;
use state::Dashi;

fn main() {
    let filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());
    tracing_subscriber::fmt().with_env_filter(filter).init();

    let args = match cli::parse(std::env::args().skip(1)) {
        Ok(Parsed::Run(args)) => args,
        Ok(Parsed::Help) => return print!("{}", cli::USAGE),
        Ok(Parsed::Version) => return println!("dashi-comp {}", env!("CARGO_PKG_VERSION")),
        Err(error) => {
            eprint!("dashi-comp: {error}\n{}", cli::USAGE);
            std::process::exit(2);
        }
    };
    if let Err(error) = run(args) {
        tracing::error!("{error}");
        std::process::exit(1);
    }
}

fn run(args: cli::Args) -> Result<(), Box<dyn std::error::Error>> {
    // First of all, before any thread exists: SIGTERM and SIGINT are blocked
    // here and in every thread made later, so they arrive only as events and
    // the compositor ends its session and puts the screens back. (A thread
    // made before this would take them and the process would just die.) The
    // session client unblocks them again (session/child.rs).
    let signals = Signals::new(&[Signal::SIGTERM, Signal::SIGINT])?;
    let mut event_loop: EventLoop<'static, Dashi> = EventLoop::try_new()?;
    let handle = event_loop.handle();

    let (mut ipc, listener) = Ipc::bind(&ipc_path()?)?;
    ipc.open = args.open_ipc;
    Ipc::listen(listener, &handle)?;
    let display: Display<Dashi> = Display::new()?;
    let mut state = Dashi::new(
        display,
        handle.clone(),
        event_loop.get_signal(),
        ipc,
        args.greeter,
    )?;

    state.apply_system_layout();
    let backend = backend_for(args.backend)?;
    match backend {
        BackendChoice::Udev => backend::udev::init(&handle, &mut state)?,
        BackendChoice::Winit => backend::winit::init(&handle, &mut state)?,
        BackendChoice::Headless => backend::headless::init(&handle, &mut state)?,
        BackendChoice::Auto => unreachable!("backend_for resolves Auto"),
    }
    tracing::info!(socket = ?state.socket_name, ipc = %state.ipc.path().display(), "dashi-comp is up");
    if args.xwayland && !args.greeter && backend != BackendChoice::Headless {
        state.start_xwayland();
    }

    if let Some(command) = &args.command {
        let x_display = state.xwayland.display.map(|n| format!(":{n}"));
        let pid = session::spawn(
            command,
            &state.socket_name,
            x_display.as_deref(),
            state.ipc.path(),
            &handle,
        )? as i32;
        state.session_client = Some(pid);
        state
            .shell_pid
            .store(pid, std::sync::atomic::Ordering::Relaxed);
    }
    handle.insert_source(signals, |event, _, state| {
        tracing::info!(signal = ?event.signal(), "stopping");
        state.loop_signal.stop();
    })?;

    event_loop.run(None, &mut state, Dashi::after_dispatch)?;
    if let Some(pid) = state.session_client {
        session::end_session(pid);
    }
    Ok(())
}

/// `DASHI_COMP_SOCKET`, else `$XDG_RUNTIME_DIR/dashi-comp.sock`.
fn ipc_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("DASHI_COMP_SOCKET") {
        return Ok(path.into());
    }
    let runtime = std::env::var_os("XDG_RUNTIME_DIR").ok_or("XDG_RUNTIME_DIR is not set")?;
    Ok(PathBuf::from(runtime).join("dashi-comp.sock"))
}

fn backend_for(choice: BackendChoice) -> Result<BackendChoice, String> {
    match choice {
        BackendChoice::Auto
            if std::env::var_os("WAYLAND_DISPLAY").is_some()
                || std::env::var_os("DISPLAY").is_some() =>
        {
            Ok(BackendChoice::Winit)
        }
        BackendChoice::Auto => Ok(BackendChoice::Udev),
        chosen => Ok(chosen),
    }
}
