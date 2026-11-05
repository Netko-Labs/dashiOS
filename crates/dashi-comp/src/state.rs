//! The compositor's state: one struct, owned by the calloop event loop.
//!
//! The Wayland plumbing here follows smithay's smallvil example (MIT,
//! github.com/Smithay/smithay, v0.7.0), adapted to Dashi's modules.

use std::{ffi::OsString, sync::Arc, time::Instant};

use smithay::{
    desktop::{
        PopupManager, Space, Window, WindowSurfaceType, layer_map_for_output,
        utils::surface_primary_scanout_output,
    },
    input::{Seat, SeatState, pointer::CursorImageStatus},
    reexports::{
        calloop::{Interest, LoopHandle, LoopSignal, Mode, PostAction, generic::Generic},
        wayland_server::{
            Display, DisplayHandle,
            backend::{ClientData, ClientId, DisconnectReason},
            protocol::wl_surface::WlSurface,
        },
    },
    utils::{Logical, Point},
    wayland::{
        compositor::{CompositorClientState, CompositorState},
        dmabuf::{DmabufGlobal, DmabufState},
        output::OutputManagerState,
        selection::data_device::DataDeviceState,
        shell::{
            wlr_layer::{Layer, WlrLayerShellState},
            xdg::{XdgShellState, decoration::XdgDecorationState},
        },
        shm::ShmState,
        socket::ListeningSocketSource,
    },
};

use crate::{
    backend::Backend,
    ipc::Ipc,
    keys::Keys,
    protocols::dashi_chrome::{self, ChromeObject},
    render::{cursor::Cursors, text::Text},
    wm::{ChromeStyle, Windows},
};

pub(crate) struct Dashi {
    pub start_time: Instant,
    pub socket_name: OsString,
    pub display_handle: DisplayHandle,
    pub loop_handle: LoopHandle<'static, Dashi>,
    pub loop_signal: LoopSignal,

    pub space: Space<Window>,
    pub windows: Windows,
    pub popups: PopupManager,
    pub ipc: Ipc,
    pub backend: Backend,
    pub dmabuf_state: DmabufState,
    pub dmabuf_global: Option<DmabufGlobal>,
    pub keys: Keys,
    pub agent: crate::session::agent::Agent,
    /// The agent's pointer as last drawn: its label, scale, and image.
    pub agent_cursor: Option<(
        String,
        i32,
        smithay::backend::renderer::element::memory::MemoryRenderBuffer,
    )>,
    /// Applets' processes and their layer-shell grants (`applet-clients`).
    pub applet_clients: crate::session::applets::AppletClients,
    /// Executables the shell lets copy the screen (`screencopy-clients`).
    pub screencopy_paths: Arc<std::sync::Mutex<Vec<std::path::PathBuf>>>,
    pub capture_activity: crate::protocols::screencopy::Activity,
    /// What agents' pictures blank, by client (`capture-mask`).
    pub capture_masks: crate::render::mask::Masks,
    /// Whose presses were whose: the person's or an agent's (`input-origin`).
    pub origins: crate::session::origin::Origins,
    pub activation_state: smithay::wayland::xdg_activation::XdgActivationState,
    #[expect(dead_code, reason = "kept alive: it owns the xdg-dialog global")]
    pub dialog_state: smithay::wayland::shell::xdg::dialog::XdgDialogState,
    pub lock: crate::session::lock::Lock,
    pub session_lock_state: smithay::wayland::session_lock::SessionLockManagerState,
    pub zones: crate::wm::Zones,
    pub motion: crate::wm::Motion,
    /// Screens turned off in Displays (not in the space).
    pub disabled_outputs: Vec<smithay::output::Output>,
    /// Touchpad and mouse settings (input/settings.rs), for devices plugged in later too.
    pub input_settings: crate::input::settings::InputSettings,
    /// Variable refresh rate per screen name, as the shell chose (outputs/vrr.rs).
    pub vrr_modes: std::collections::HashMap<String, crate::outputs::VrrMode>,
    /// The primary screen's name, when one was chosen.
    pub primary_output: Option<String>,
    pub idle: crate::session::idle::Idle,
    pub claims: crate::input::Claims,
    pub overview: Option<crate::wm::Overview>,
    pub spaces: crate::wm::Spaces,
    /// Live pictures the shell placed (`space-previews`, `window-thumbnails`).
    pub thumbnails: crate::render::thumbnails::Thumbnails,
    /// The window held in a move grab, which goes along when the Space changes.
    pub held: Option<crate::wm::WindowId>,
    /// A held window against a screen edge (`edge-hold`).
    pub edge_hold: crate::wm::EdgeHold,
    pub bars: crate::wm::Bars,
    pub wallpaper: crate::wallpaper::Wallpaper,
    /// The session's client (`-c`): it and the processes under it are the shell.
    pub session_client: Option<i32>,
    /// The same, for global filters (which see no state).
    pub shell_pid: Arc<std::sync::atomic::AtomicI32>,
    pub foreign: crate::protocols::foreign_toplevel::ForeignToplevels,
    pub chrome_style: ChromeStyle,
    pub chrome_objects: Vec<(WlSurface, ChromeObject)>,
    pub cursor_status: CursorImageStatus,
    /// The icon a client gave the drag it started (wl_data_device.start_drag),
    /// drawn under the pointer until the drop, and how far it sits from the
    /// pointer (the surface's attach offsets, summed).
    pub dnd_icon: Option<(
        WlSurface,
        smithay::utils::Point<i32, smithay::utils::Logical>,
    )>,
    /// Over a window's resize border, or resizing it: that cursor, over the client's.
    pub resize_cursor: Option<smithay::input::pointer::CursorIcon>,
    /// The last press on a title bar, for double-clicks.
    pub last_bar_press: Option<(u64, std::time::Instant)>,
    /// Buttons whose press went to a window's sheet instead of the window; their release goes nowhere (wm/sheets.rs).
    pub swallowed_buttons: Vec<u32>,
    pub cursors: Cursors,
    /// Where the shell's layer surfaces take the pointer (IPC `input-region`).
    pub layer_regions: crate::handlers::layer_regions::LayerRegions,
    pub text: Text,
    #[expect(dead_code, reason = "kept alive: it owns the xdg-decoration global")]
    pub xdg_decoration_state: XdgDecorationState,

    pub compositor_state: CompositorState,
    pub xdg_shell_state: XdgShellState,
    pub layer_shell_state: WlrLayerShellState,
    pub shm_state: ShmState,
    #[expect(dead_code, reason = "kept alive: it owns the xdg-output globals")]
    pub output_manager_state: OutputManagerState,
    pub seat_state: SeatState<Dashi>,
    pub data_device_state: DataDeviceState,
    pub primary_selection_state:
        smithay::wayland::selection::primary_selection::PrimarySelectionState,
    /// Clipboard access without focus (clipboard history, wl-copy): the shell's processes only.
    pub data_control: Option<(
        smithay::wayland::selection::ext_data_control::DataControlState,
        smithay::wayland::selection::wlr_data_control::DataControlState,
    )>,
    /// xdg-foreign's exported windows, by handle (protocols/xdg_foreign.rs).
    pub xdg_foreign: crate::protocols::xdg_foreign::ForeignExports,
    /// ext-foreign-toplevel-list, for capture pickers (protocols/toplevel_list.rs).
    pub toplevel_list: Option<crate::protocols::toplevel_list::ToplevelList>,
    /// Explicit sync, when the drawing GPU supports it (handlers/sync.rs).
    pub syncobj_state: Option<smithay::wayland::drm_syncobj::DrmSyncobjState>,
    pub shortcuts_inhibit_state:
        smithay::wayland::keyboard_shortcuts_inhibit::KeyboardShortcutsInhibitState,
    pub xwayland_shell_state: smithay::wayland::xwayland_shell::XWaylandShellState,
    pub xwayland: crate::xwayland::Xwayland,
    pub seat: Seat<Dashi>,
}

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
        let shell_pid = Arc::new(std::sync::atomic::AtomicI32::new(0));
        let activation_state =
            smithay::wayland::xdg_activation::XdgActivationState::new::<Self>(&dh);
        let dialog_state = smithay::wayland::shell::xdg::dialog::XdgDialogState::new::<Self>(&dh);
        let screencopy_paths = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut toplevel_list = None;
        // The login screen shows no one the window list or the screen.
        if !greeter {
            crate::protocols::foreign_toplevel::create_global(&dh, shell_pid.clone());
            let grants = crate::protocols::screencopy::Grants {
                shell: shell_pid.clone(),
                paths: screencopy_paths.clone(),
            };
            crate::protocols::screencopy::create_global(&dh, grants.clone());
            crate::protocols::image_capture::create_globals(&dh, &grants);
            toplevel_list = Some(crate::protocols::toplevel_list::ToplevelList::new(
                &dh, grants,
            ));
        }
        let lock_shell = shell_pid.clone();
        let session_lock_state =
            smithay::wayland::session_lock::SessionLockManagerState::new::<Self, _>(
                &dh,
                move |client| crate::session::trust::is_shell_client(client, &lock_shell),
            );
        let shm_state = ShmState::new::<Self>(&dh, vec![]);
        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&dh);
        let data_device_state = DataDeviceState::new::<Self>(&dh);
        let primary_selection_state =
            smithay::wayland::selection::primary_selection::PrimarySelectionState::new::<Self>(&dh);
        let data_control = (!greeter).then(|| {
            let (ext_shell, wlr_shell) = (shell_pid.clone(), shell_pid.clone());
            (
                smithay::wayland::selection::ext_data_control::DataControlState::new::<Self, _>(
                    &dh,
                    Some(&primary_selection_state),
                    move |client| crate::session::trust::is_shell_client(client, &ext_shell),
                ),
                smithay::wayland::selection::wlr_data_control::DataControlState::new::<Self, _>(
                    &dh,
                    Some(&primary_selection_state),
                    move |client| crate::session::trust::is_shell_client(client, &wlr_shell),
                ),
            )
        });
        crate::handlers::surface::create_globals(&dh);
        crate::handlers::pointer::create_globals(&dh);
        let shortcuts_inhibit_state = crate::handlers::inhibit::create_globals(&dh);
        crate::handlers::text::create_globals(&dh, &shell_pid, greeter);
        crate::handlers::security::create_global(&dh);
        crate::handlers::toplevel_meta::create_globals(&dh);
        crate::render::present::create_global(&dh);
        crate::protocols::xdg_foreign::create_globals(&dh);
        let xwayland_shell_state =
            smithay::wayland::xwayland_shell::XWaylandShellState::new::<Self>(&dh);
        let mut seat_state = SeatState::new();
        let mut seat: Seat<Self> = seat_state.new_wl_seat(&dh, "seat0");
        // C1 follows keyboards and pointers as they come and go (libinput).
        seat.add_keyboard(Default::default(), 200, 25)?;
        seat.add_pointer();
        // The agent's hands: a seat of their own (session/agent.rs).
        // A second wl_seat only when asked for: toolkits that read one seat
        // (GPUI, so the shell itself) follow the last one announced and would
        // lose the person's keyboard (session/agent.rs).
        let agent_seat = if std::env::var_os("DASHI_AGENT_SEAT").is_some_and(|v| v == "1") {
            let mut seat: Seat<Self> = seat_state.new_wl_seat(&dh, "agent");
            seat.add_keyboard(Default::default(), 200, 25)?;
            seat.add_pointer();
            Some(seat)
        } else {
            None
        };

        let socket_name = listen(display, &loop_handle)?;

        Ok(Self {
            start_time: Instant::now(),
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
            disabled_outputs: Vec::new(),
            primary_output: None,
            vrr_modes: Default::default(),
            input_settings: Default::default(),
            idle: Default::default(),
            claims: Default::default(),
            overview: None,
            spaces: Default::default(),
            thumbnails: Default::default(),
            held: None,
            edge_hold: Default::default(),
            bars: Default::default(),
            wallpaper: Default::default(),
            session_client: None,
            shell_pid,
            foreign: Default::default(),
            chrome_style: ChromeStyle::default(),
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

    /// The surface under `pos`, and where that surface's origin is: the
    /// overlay and top layers, then windows, then the bottom and background layers.
    pub(crate) fn surface_under(
        &self,
        pos: Point<f64, Logical>,
    ) -> Option<(WlSurface, Point<f64, Logical>)> {
        let window = || {
            self.space
                .element_under(pos)
                .and_then(|(window, location)| {
                    window
                        .surface_under(pos - location.to_f64(), WindowSurfaceType::ALL)
                        .map(|(surface, at)| (surface, (at + location).to_f64()))
                })
        };
        if self.lock.locked {
            let output = self.space.output_under(pos).next()?;
            let origin = self.space.output_geometry(output)?.loc;
            let lock = self.lock_surface_on(output)?;
            return smithay::desktop::utils::under_from_surface_tree(
                lock.wl_surface(),
                pos - origin.to_f64(),
                (0, 0),
                WindowSurfaceType::ALL,
            )
            .map(|(surface, at)| (surface, (at + origin).to_f64()));
        }
        let Some(output) = self.space.output_under(pos).next() else {
            return window();
        };
        let Some(origin) = self.space.output_geometry(output).map(|g| g.loc) else {
            return window();
        };
        // The layer map's lock is taken for each look and let go before anything
        // else that takes it (decoration_at does): a second lock would deadlock.
        // A surface the shell limited (IPC `input-region`) lets the pointer
        // through outside its rects, to whatever is under it (layer_regions.rs).
        let in_layer = |layer: Layer| {
            let layers = layer_map_for_output(output);
            let local = pos - origin.to_f64();
            layers
                .layers_on(layer)
                .rev()
                .find_map(|surface| self.layer_hit(&layers, surface, local))
                .map(|(surface, at)| (surface, at + origin.to_f64()))
        };
        let top_shown = self.shows_top_layers(output);
        if let Some(top) =
            in_layer(Layer::Overlay).or_else(|| top_shown.then(|| in_layer(Layer::Top)).flatten())
        {
            return Some(top);
        }
        // The overview's windows are the overview's, not their clients'.
        if self.overview.is_some() {
            return None;
        }
        // A title bar or the traffic lights: nothing a client gets.
        if self.decoration_at(pos).is_some() {
            return None;
        }
        window()
            .or_else(|| in_layer(Layer::Bottom))
            .or_else(|| in_layer(Layer::Background))
    }

    /// Tell every client shown on `output` that a frame went out, so it draws the next.
    pub(crate) fn send_frames(&self, output: &smithay::output::Output) {
        self.send_preferred_scales(output);
        let elapsed = self.start_time.elapsed();
        // Surfaces another screen shows (or none) still hear about once a second.
        let throttle = Some(std::time::Duration::from_secs(1));
        self.space.elements().for_each(|window| {
            window.send_frame(output, elapsed, throttle, surface_primary_scanout_output);
        });
        // Off screen but in a live picture (render/thumbnails/): they draw on, at the screen's pace.
        for window in self.pictured_off_screen() {
            window.send_frame(output, elapsed, None, |_, _| Some(output.clone()));
        }
        for layer in layer_map_for_output(output).layers() {
            layer.send_frame(output, elapsed, throttle, surface_primary_scanout_output);
        }
        if let Some(lock) = self.lock_surface_on(output) {
            smithay::desktop::utils::send_frames_surface_tree(
                lock.wl_surface(),
                output,
                elapsed,
                throttle,
                |_, _| Some(output.clone()),
            );
        }
        if let smithay::input::pointer::CursorImageStatus::Surface(surface) = &self.cursor_status {
            smithay::desktop::utils::send_frames_surface_tree(
                surface,
                output,
                elapsed,
                throttle,
                |_, _| Some(output.clone()),
            );
        }
    }

    /// `at`, kept on a screen: the nearest point of the nearest screen when it leaves them.
    pub(crate) fn clamp_to_screens(&self, at: Point<f64, Logical>) -> Point<f64, Logical> {
        let screens: Vec<_> = self
            .space
            .outputs()
            .filter_map(|o| self.space.output_geometry(o))
            .collect();
        if screens.iter().any(|g| g.to_f64().contains(at)) || screens.is_empty() {
            return at;
        }
        screens
            .iter()
            .map(|g| {
                let g = g.to_f64();
                let x = at.x.clamp(g.loc.x, g.loc.x + g.size.w - 1.0);
                let y = at.y.clamp(g.loc.y, g.loc.y + g.size.h - 1.0);
                Point::from((x, y))
            })
            .min_by(|a, b| {
                let d = |p: &Point<f64, Logical>| (p.x - at.x).powi(2) + (p.y - at.y).powi(2);
                d(a).total_cmp(&d(b))
            })
            .unwrap_or(at)
    }

    /// After each turn of the loop: settle the space and send what is queued.
    pub(crate) fn after_dispatch(&mut self) {
        self.follow_sheets();
        self.space.refresh();
        self.popups.cleanup();
        self.foreign_refresh();
        self.toplevel_list_refresh();
        if let Err(error) = self.display_handle.flush_clients() {
            tracing::warn!(%error, "flushing Wayland clients");
        }
        self.ipc.flush();
    }
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
            Ok(PostAction::Continue)
        },
    )?;
    Ok(name)
}

#[derive(Default)]
pub(crate) struct ClientState {
    pub compositor_state: CompositorClientState,
    /// The client's process (SO_PEERCRED), for protocols only the shell may bind.
    pub pid: Option<i32>,
    /// The sandbox it connected through (security-context), if any.
    pub sandbox: Option<smithay::wayland::security_context::SecurityContext>,
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}
