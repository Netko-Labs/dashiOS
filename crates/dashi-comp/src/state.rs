//! The compositor's state: one struct, owned by the calloop event loop.
//!
//! The Wayland plumbing here follows smithay's smallvil example (MIT,
//! github.com/Smithay/smithay, v0.7.0), adapted to Dashi's modules.

use std::{ffi::OsString, sync::Arc, time::Instant};

use smithay::{
    desktop::{PopupManager, Space, Window, WindowSurfaceType, layer_map_for_output},
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
    shell_config::ShellConfig,
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
    pub shell_config: ShellConfig,
    pub keys: Keys,
    pub spaces: crate::wm::Spaces,
    pub bars: crate::wm::Bars,
    pub wallpaper: crate::wallpaper::Wallpaper,
    /// The session's client (`-c`): it and the processes under it are the shell.
    pub session_client: Option<i32>,
    pub chrome_style: ChromeStyle,
    pub chrome_objects: Vec<(WlSurface, ChromeObject)>,
    pub cursor_status: CursorImageStatus,
    /// The last press on a title bar, for double-clicks.
    pub last_bar_press: Option<(u64, std::time::Instant)>,
    pub cursors: Cursors,
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
    pub seat: Seat<Dashi>,
}

impl Dashi {
    pub(crate) fn new(
        display: Display<Self>,
        loop_handle: LoopHandle<'static, Dashi>,
        loop_signal: LoopSignal,
        ipc: Ipc,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let dh = display.handle();

        let compositor_state = CompositorState::new::<Self>(&dh);
        let xdg_shell_state = XdgShellState::new::<Self>(&dh);
        let layer_shell_state = WlrLayerShellState::new::<Self>(&dh);
        let xdg_decoration_state = XdgDecorationState::new::<Self>(&dh);
        dashi_chrome::create_global(&dh);
        let shm_state = ShmState::new::<Self>(&dh, vec![]);
        let output_manager_state = OutputManagerState::new_with_xdg_output::<Self>(&dh);
        let data_device_state = DataDeviceState::new::<Self>(&dh);
        let mut seat_state = SeatState::new();
        let mut seat: Seat<Self> = seat_state.new_wl_seat(&dh, "seat0");
        // C1 follows keyboards and pointers as they come and go (libinput).
        seat.add_keyboard(Default::default(), 200, 25)?;
        seat.add_pointer();

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
            shell_config: ShellConfig::default(),
            keys: Keys::default(),
            spaces: Default::default(),
            bars: Default::default(),
            wallpaper: Default::default(),
            session_client: None,
            chrome_style: ChromeStyle::default(),
            chrome_objects: Vec::new(),
            cursor_status: CursorImageStatus::default_named(),
            last_bar_press: None,
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
        let Some(output) = self.space.output_under(pos).next() else {
            return window();
        };
        let Some(origin) = self.space.output_geometry(output).map(|g| g.loc) else {
            return window();
        };
        let layers = layer_map_for_output(output);
        let in_layer = |layer: Layer| {
            let local = pos - origin.to_f64();
            let surface = layers.layer_under(layer, local)?;
            let at = layers.layer_geometry(surface)?.loc;
            surface
                .surface_under(local - at.to_f64(), WindowSurfaceType::ALL)
                .map(|(surface, loc)| (surface, (loc + at + origin).to_f64()))
        };
        let top_shown = self.shows_top_layers(output);
        if let Some(top) =
            in_layer(Layer::Overlay).or_else(|| top_shown.then(|| in_layer(Layer::Top)).flatten())
        {
            return Some(top);
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
        let elapsed = self.start_time.elapsed();
        let throttle = Some(std::time::Duration::ZERO);
        self.space.elements().for_each(|window| {
            window.send_frame(output, elapsed, throttle, |_, _| Some(output.clone()));
        });
        for layer in layer_map_for_output(output).layers() {
            layer.send_frame(output, elapsed, throttle, |_, _| Some(output.clone()));
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
        self.space.refresh();
        self.popups.cleanup();
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
        if let Err(error) = state
            .display_handle
            .insert_client(stream, Arc::new(ClientState::default()))
        {
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
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}
