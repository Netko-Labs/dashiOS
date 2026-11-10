//! The clients of the lock tests (tests/lock.rs), one Wayland connection
//! each: a window, the lock screen, a shell sheet (a layer surface), and a
//! virtual keyboard that types, and an input method that grabs the keyboard.
//! Each hears its keyboard (enter, leave, keys), so a test can tell which of
//! them the keys went to.

mod actions;
mod buffer;
mod events;

use std::path::Path;

use wayland_client::{
    Connection, EventQueue, QueueHandle,
    globals::{GlobalList, registry_queue_init},
    protocol::{wl_compositor, wl_seat, wl_shm, wl_surface},
};
use wayland_protocols::{
    ext::session_lock::v1::client::{ext_session_lock_surface_v1, ext_session_lock_v1},
    xdg::shell::client::{xdg_surface, xdg_toplevel},
};
use wayland_protocols_misc::{
    zwp_input_method_v2::client::{zwp_input_method_keyboard_grab_v2, zwp_input_method_v2},
    zwp_virtual_keyboard_v1::client::zwp_virtual_keyboard_v1,
};
use wayland_protocols_wlr::layer_shell::v1::client::zwlr_layer_surface_v1;

/// evdev KEY_A.
pub const KEY_A: u32 = 30;

/// One connection and what it heard.
pub struct Conn {
    queue: EventQueue<State>,
    pub state: State,
    globals: GlobalList,
    qh: QueueHandle<State>,
    compositor: wl_compositor::WlCompositor,
    seat: wl_seat::WlSeat,
}

#[derive(Default)]
pub struct State {
    shm: Option<wl_shm::WlShm>,
    surface: Option<wl_surface::WlSurface>,
    /// The keyboard: how often it entered and left this connection's surfaces, whether it is on one, and the keys pressed there.
    pub enters: usize,
    pub leaves: usize,
    pub focused: bool,
    pub keys: Vec<u32>,
    /// A window: configured and drawn.
    pub shown: bool,
    xdg: Option<(xdg_surface::XdgSurface, xdg_toplevel::XdgToplevel)>,
    /// The lock: `locked` once the compositor says so; its surface drawn.
    pub locked: bool,
    pub finished: bool,
    lock: Option<ext_session_lock_v1::ExtSessionLockV1>,
    lock_surface: Option<ext_session_lock_surface_v1::ExtSessionLockSurfaceV1>,
    pub lock_shown: bool,
    /// A sheet (layer surface): drawn, or closed by the compositor.
    layer: Option<zwlr_layer_surface_v1::ZwlrLayerSurfaceV1>,
    pub layer_shown: bool,
    pub layer_closed: bool,
    /// An activation token, once the compositor gave it.
    token: Option<String>,
    keyboard_typist: Option<zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1>,
    /// An input method (fcitx5's part), kept alive; the keys its keyboard grab heard (tests/agent_keys.rs).
    #[allow(dead_code)]
    input_method: Option<(
        zwp_input_method_v2::ZwpInputMethodV2,
        zwp_input_method_keyboard_grab_v2::ZwpInputMethodKeyboardGrabV2,
    )>,
    pub input_method_keys: Vec<u32>,
}

impl Conn {
    pub fn connect(runtime_dir: &Path, display: &str) -> Self {
        let stream = std::os::unix::net::UnixStream::connect(runtime_dir.join(display))
            .expect("the Wayland socket");
        let connection = Connection::from_socket(stream).expect("a Wayland connection");
        let (globals, queue) = registry_queue_init::<State>(&connection).expect("the registry");
        let qh = queue.handle();
        let compositor: wl_compositor::WlCompositor =
            globals.bind(&qh, 4..=6, ()).expect("wl_compositor");
        let shm: wl_shm::WlShm = globals.bind(&qh, 1..=1, ()).expect("wl_shm");
        let seat: wl_seat::WlSeat = globals.bind(&qh, 1..=7, ()).expect("wl_seat");
        seat.get_keyboard(&qh, ());
        let mut conn = Self {
            queue,
            state: State {
                shm: Some(shm),
                ..State::default()
            },
            globals,
            qh,
            compositor,
            seat,
        };
        conn.roundtrip();
        conn
    }

    /// Everything sent so far handled by the compositor, and its answers here.
    pub fn roundtrip(&mut self) {
        self.queue
            .roundtrip(&mut self.state)
            .expect("the compositor answers");
    }
}
