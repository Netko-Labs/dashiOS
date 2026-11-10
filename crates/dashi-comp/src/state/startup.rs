//! Starting the compositor's state: the Wayland globals it serves, its seats,
//! and the socket clients connect to.

use std::{
    ffi::OsString,
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicI32},
    time::Instant,
};

use smithay::{
    desktop::{PopupManager, Space},
    input::{Seat, SeatState, pointer::CursorImageStatus},
    reexports::{
        calloop::{Interest, LoopHandle, LoopSignal, Mode, PostAction, generic::Generic},
        wayland_server::{Display, DisplayHandle},
    },
    wayland::{
        compositor::CompositorState,
        dmabuf::DmabufState,
        keyboard_shortcuts_inhibit::KeyboardShortcutsInhibitState,
        output::OutputManagerState,
        selection::{
            data_device::DataDeviceState,
            ext_data_control::DataControlState as ExtDataControlState,
            primary_selection::PrimarySelectionState,
            wlr_data_control::DataControlState as WlrDataControlState,
        },
        shell::{
            wlr_layer::WlrLayerShellState,
            xdg::{XdgShellState, decoration::XdgDecorationState},
        },
        shm::ShmState,
        socket::ListeningSocketSource,
    },
};

use super::{ClientState, Dashi};
use crate::{
    backend::Backend,
    ipc::Ipc,
    keys::Keys,
    protocols::dashi_chrome,
    render::{cursor::Cursors, text::Text},
    wm::{ChromeStyle, Windows},
};

impl Dashi {
    pub(crate) fn new(
        display: Display<Self>,
        loop_handle: LoopHandle<'static, Dashi>,
        loop_signal: LoopSignal,
        ipc: Ipc,
        greeter: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let dh = display.handle();

        let compositor_state = CompositorState::new::<Self>(&dh);
        let xdg_shell_state = XdgShellState::new::<Self>(&dh);
        let layer_shell_state = WlrLayerShellState::new::<Self>(&dh);
        let xdg_decoration_state = XdgDecorationState::new::<Self>(&dh);
        dashi_chrome::create_global(&dh);
        let shell_pid = Arc::new(AtomicI32::new(0));
        let activation_state =
            smithay::wayland::xdg_activation::XdgActivationState::new::<Self>(&dh);
        let dialog_state = smithay::wayland::shell::xdg::dialog::XdgDialogState::new::<Self>(&dh);
        let screencopy_paths = Arc::new(Mutex::new(Vec::new()));
        let toplevel_list = capture_globals(&dh, greeter, &shell_pid, &screencopy_paths);
        let lock_shell = shell_pid.clone();
        let session_lock_state =
            smithay::wayland::session_lock::SessionLockManagerState::new::<Self, _>(
                &dh,
                move |client| crate::session::trust::is_shell_client(client, &lock_shell),
            );
        let shm_state = ShmState::new::<Self>(&dh, vec![]);
        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&dh);
        let data_device_state = DataDeviceState::new::<Self>(&dh);
        let primary_selection_state = PrimarySelectionState::new::<Self>(&dh);
        let data_control = data_control_states(&dh, greeter, &shell_pid, &primary_selection_state);
        let shortcuts_inhibit_state = handler_globals(&dh, &shell_pid, greeter);
        let xwayland_shell_state =
            smithay::wayland::xwayland_shell::XWaylandShellState::new::<Self>(&dh);
        let (seat_state, seat, agent_seat) = seats(&dh)?;

        let socket_name = listen(display, &loop_handle)?;

        Ok(Self {
            start_time: Instant::now(),
            wakes: crate::wakes::Wakes::default(),
            decor_scale: 1,
            socket_name,
            display_handle: dh,
            loop_handle,
            loop_signal,
            space: Space::default(),
            windows: Windows::default(),
            popups: PopupManager::default(),
            ipc,
            backend: Backend::None,
            dmabuf_state: DmabufState::new(),
            dmabuf_global: None,
            keys: Keys::default(),
            agent: crate::session::agent::Agent::new(agent_seat),
            agent_cursor: None,
            applet_clients: Default::default(),
            screencopy_paths,
            capture_activity: Default::default(),
            capture_masks: Default::default(),
            origins: Default::default(),
            activation_state,
            dialog_state,
            lock: Default::default(),
            session_lock_state,
            zones: Default::default(),
            motion: Default::default(),
            layer_motion: Default::default(),
            disabled_outputs: Vec::new(),
            mirrors: Default::default(),
            primary_output: None,
            vrr_modes: Default::default(),
            input_settings: Default::default(),
            idle: Default::default(),
            claims: Default::default(),
            overview: None,
            spaces: Default::default(),
            thumbnails: Default::default(),
            held: None,
            carried: None,
            held_reframed: false,
            edge_hold: Default::default(),
            bars: Default::default(),
            wallpaper: Default::default(),
            session_client: None,
            shell_pid,
            foreign: Default::default(),
            chrome_style: ChromeStyle::default(),
            window_style: Default::default(),
            chrome_objects: Vec::new(),
            layer_regions: Default::default(),
            cursor_status: CursorImageStatus::default_named(),
            dnd_icon: None,
            resize_cursor: None,
            last_bar_press: None,
            swallowed_buttons: Vec::new(),
            cursors: Cursors::default(),
            text: Text::default(),
            xdg_decoration_state,
            compositor_state,
            xdg_shell_state,
            layer_shell_state,
            shm_state,
            output_manager_state,
            seat_state,
            data_device_state,
            primary_selection_state,
            data_control,
            shortcuts_inhibit_state,
            xdg_foreign: Default::default(),
            toplevel_list,
            syncobj_state: None,
            xwayland_shell_state,
            xwayland: Default::default(),
            seat,
        })
    }
}

/// The globals that show the screen or the window list: none on the login screen.
fn capture_globals(
    dh: &DisplayHandle,
    greeter: bool,
    shell_pid: &Arc<AtomicI32>,
    screencopy_paths: &Arc<Mutex<Vec<PathBuf>>>,
) -> Option<crate::protocols::toplevel_list::ToplevelList> {
    // The login screen shows no one the window list or the screen.
    if greeter {
        return None;
    }
    crate::protocols::foreign_toplevel::create_global(dh, shell_pid.clone());
    let grants = crate::protocols::screencopy::Grants {
        shell: shell_pid.clone(),
        paths: screencopy_paths.clone(),
    };
    crate::protocols::screencopy::create_global(dh, grants.clone());
    crate::protocols::image_capture::create_globals(dh, &grants);
    Some(crate::protocols::toplevel_list::ToplevelList::new(
        dh, grants,
    ))
}

/// The clipboard managers' protocols (ext and wlr data control): the shell's only, none on
/// the login screen.
fn data_control_states(
    dh: &DisplayHandle,
    greeter: bool,
    shell_pid: &Arc<AtomicI32>,
    primary_selection_state: &PrimarySelectionState,
) -> Option<(ExtDataControlState, WlrDataControlState)> {
    (!greeter).then(|| {
        let (ext_shell, wlr_shell) = (shell_pid.clone(), shell_pid.clone());
        (
            ExtDataControlState::new::<Dashi, _>(
                dh,
                Some(primary_selection_state),
                move |client| crate::session::trust::is_shell_client(client, &ext_shell),
            ),
            WlrDataControlState::new::<Dashi, _>(
                dh,
                Some(primary_selection_state),
                move |client| crate::session::trust::is_shell_client(client, &wlr_shell),
            ),
        )
    })
}

/// The globals smithay's handlers and Dashi's own protocols serve; the shortcuts-inhibit
/// state, which the compositor keeps.
fn handler_globals(
    dh: &DisplayHandle,
    shell_pid: &Arc<AtomicI32>,
    greeter: bool,
) -> KeyboardShortcutsInhibitState {
    crate::handlers::surface::create_globals(dh);
    crate::handlers::pointer::create_globals(dh);
    let inhibit = crate::handlers::inhibit::create_globals(dh);
    crate::handlers::text::create_globals(dh, shell_pid, greeter);
    crate::handlers::security::create_global(dh);
    crate::handlers::toplevel_meta::create_globals(dh);
    crate::render::present::create_global(dh);
    crate::protocols::xdg_foreign::create_globals(dh);
    inhibit
}

/// The seats' state, the person's seat, and the agent's.
type Seats = (SeatState<Dashi>, Seat<Dashi>, Option<Seat<Dashi>>);

/// The person's seat, and the agent's (a seat of their own) when asked for.
fn seats(dh: &DisplayHandle) -> Result<Seats, Box<dyn std::error::Error>> {
    let mut seat_state = SeatState::new();
    let mut seat: Seat<Dashi> = seat_state.new_wl_seat(dh, "seat0");
    // C1 follows keyboards and pointers as they come and go (libinput).
    seat.add_keyboard(Default::default(), 200, 25)?;
    seat.add_pointer();
    // The agent's hands: a seat of their own (session/agent.rs).
    // A second wl_seat only when asked for: toolkits that read one seat
    // (GPUI, so the shell itself) follow the last one announced and would
    // lose the person's keyboard (session/agent.rs).
    let agent_seat = if std::env::var_os("DASHI_AGENT_SEAT").is_some_and(|v| v == "1") {
        let mut seat: Seat<Dashi> = seat_state.new_wl_seat(dh, "agent");
        seat.add_keyboard(Default::default(), 200, 25)?;
        seat.add_pointer();
        Some(seat)
    } else {
        None
    };
    Ok((seat_state, seat, agent_seat))
}

/// The Wayland socket (`wayland-N`), and the display dispatched on the loop.
fn listen(
    display: Display<Dashi>,
    handle: &LoopHandle<'static, Dashi>,
) -> Result<OsString, Box<dyn std::error::Error>> {
    let socket = ListeningSocketSource::new_auto()?;
    let name = socket.socket_name().to_os_string();
    handle.insert_source(socket, |stream, _, state| {
        let pid = rustix::net::sockopt::socket_peercred(&stream)
            .ok()
            .map(|cred| cred.pid.as_raw_nonzero().get());
        let data = ClientState {
            pid,
            ..ClientState::default()
        };
        if let Err(error) = state.display_handle.insert_client(stream, Arc::new(data)) {
            tracing::warn!(%error, "a Wayland client could not connect");
        }
    })?;
    handle.insert_source(
        Generic::new(display, Interest::READ, Mode::Level),
        |_, display, state| {
            // SAFETY: the display is owned by this source and never dropped while it dispatches.
            unsafe {
                display.get_mut().dispatch_clients(state)?;
            }
            state.wakes.poke();
            Ok(PostAction::Continue)
        },
    )?;
    Ok(name)
}
