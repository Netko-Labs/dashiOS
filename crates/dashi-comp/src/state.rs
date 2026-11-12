//! The compositor's state: one struct, owned by the calloop event loop.
//!
//! The Wayland plumbing here follows smithay's smallvil example (MIT,
//! github.com/Smithay/smithay, v0.7.0), adapted to Dashi's modules.

use std::{ffi::OsString, sync::Arc, time::Instant};

use smithay::{
    desktop::{PopupManager, Space, Window},
    input::{Seat, SeatState, pointer::CursorImageStatus},
    reexports::{
        calloop::{LoopHandle, LoopSignal},
        wayland_server::{
            DisplayHandle,
            backend::{ClientData, ClientId, DisconnectReason},
            protocol::wl_surface::WlSurface,
        },
    },
    wayland::{
        compositor::{CompositorClientState, CompositorState},
        dmabuf::{DmabufGlobal, DmabufState},
        output::OutputManagerState,
        selection::data_device::DataDeviceState,
        shell::{
            wlr_layer::WlrLayerShellState,
            xdg::{XdgShellState, decoration::XdgDecorationState},
        },
        shm::ShmState,
    },
};

mod startup;

use crate::{
    backend::Backend,
    ipc::Ipc,
    keys::Keys,
    protocols::dashi_chrome::ChromeObject,
    render::{cursor::Cursors, text::Text},
    wm::{ChromeStyle, Windows},
};

pub(crate) struct Dashi {
    pub start_time: Instant,
    /// What woke the event loop lately: whether idle screens may sleep (wakes.rs).
    pub wakes: crate::wakes::Wakes,
    /// The scale title bars are drawn at for the view being built (wm/decor.rs).
    pub decor_scale: i32,
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
    /// Shell surfaces that come in with motion (`layer-motion`).
    pub layer_motion: crate::wm::LayerMotion,
    /// Screens turned off in Displays (not in the space).
    pub disabled_outputs: Vec<smithay::output::Output>,
    /// Screens showing another's picture (`mirror`; not in the space).
    pub mirrors: crate::outputs::Mirrors,
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
    /// A window the shell asked to carry across the next switch
    /// (`space-switch {carry}`): it stays on screen while the Spaces slide
    /// under it, as a held one does, and lands on the new Space.
    pub carried: Option<crate::wm::WindowId>,
    /// The shell framed the held window (`frame` while it is dragged): the
    /// grab holds it at its new frame from the next motion (move_grab.rs).
    pub held_reframed: bool,
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
    /// The depth between windows (`window-style`; render/depth/).
    pub window_style: crate::render::depth::Style,
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
    /// After each turn of the loop: settle the space and send what is queued.
    pub(crate) fn after_dispatch(&mut self) {
        self.follow_sheets();
        self.space.refresh();
        // A still pointer over a window that moved or went: the surface under it now (input/follow.rs).
        self.follow_pointers();
        self.popups.cleanup();
        self.foreign_refresh();
        self.toplevel_list_refresh();
        if let Err(error) = self.display_handle.flush_clients() {
            tracing::warn!(%error, "flushing Wayland clients");
        }
        self.ipc.flush();
        // Anything but a screen's frame timer: sleeping screens look again (wakes.rs).
        let woke = self.wakes.turn_ended();
        if woke != crate::wakes::Woke::Frames {
            crate::backend::udev::wake_screens(self, woke);
        }
    }
}

#[derive(Default)]
pub(crate) struct ClientState {
    pub compositor_state: CompositorClientState,
    /// The client's process, held by a pidfd (session/process.rs), for protocols only the
    /// shell may bind: asked about each time, long after it connected.
    pub process: Option<crate::session::process::Held>,
    /// The sandbox it connected through (security-context), if any.
    pub sandbox: Option<smithay::wayland::security_context::SecurityContext>,
}

impl ClientState {
    /// The pid of the process that connected, while that process lives.
    pub(crate) fn pid(&self) -> Option<i32> {
        self.process.as_ref().and_then(|process| process.pid())
    }
}

impl ClientData for ClientState {
    fn initialized(&self, _client_id: ClientId) {}
    fn disconnected(&self, _client_id: ClientId, _reason: DisconnectReason) {}
}
