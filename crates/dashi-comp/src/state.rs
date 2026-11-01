//! The compositor's state: one struct, owned by the calloop event loop.
//!
//! The Wayland plumbing here follows smithay's smallvil example (MIT,
//! github.com/Smithay/smithay, v0.7.0), adapted to Dashi's modules.

use std::{ffi::OsString, sync::Arc, time::Instant};

use smithay::{
    desktop::{PopupManager, Space, Window, WindowSurfaceType},
    input::{Seat, SeatState},
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
        output::OutputManagerState,
        selection::data_device::DataDeviceState,
        shell::xdg::XdgShellState,
        shm::ShmState,
        socket::ListeningSocketSource,
    },
};

use crate::{ipc::Ipc, wm::Windows};

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

    pub compositor_state: CompositorState,
    pub xdg_shell_state: XdgShellState,
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
            compositor_state,
            xdg_shell_state,
            shm_state,
            output_manager_state,
            seat_state,
            data_device_state,
            seat,
        })
    }

    /// The surface under `pos`, and where that surface's origin is.
    pub(crate) fn surface_under(
        &self,
        pos: Point<f64, Logical>,
    ) -> Option<(WlSurface, Point<f64, Logical>)> {
        self.space
            .element_under(pos)
            .and_then(|(window, location)| {
                window
                    .surface_under(pos - location.to_f64(), WindowSurfaceType::ALL)
                    .map(|(surface, at)| (surface, (at + location).to_f64()))
            })
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
