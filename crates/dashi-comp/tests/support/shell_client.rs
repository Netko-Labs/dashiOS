//! The clients of the lock tests (tests/lock.rs), one Wayland connection
//! each: a window, the lock screen, a shell sheet (a layer surface), and a
//! virtual keyboard that types, and an input method that grabs the keyboard.
//! Each hears its keyboard (enter, leave, keys), so a test can tell which of
//! them the keys went to.

use std::{io::Write, os::fd::AsFd, path::Path};

use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, WEnum, delegate_noop,
    globals::{GlobalList, GlobalListContents, registry_queue_init},
    protocol::{
        wl_buffer, wl_compositor, wl_keyboard, wl_output, wl_registry, wl_seat, wl_shm,
        wl_shm_pool, wl_surface,
    },
};
use wayland_protocols::{
    ext::session_lock::v1::client::{
        ext_session_lock_manager_v1, ext_session_lock_surface_v1, ext_session_lock_v1,
    },
    xdg::{
        activation::v1::client::{xdg_activation_token_v1, xdg_activation_v1},
        shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base},
    },
};
use wayland_protocols_misc::{
    zwp_input_method_v2::client::{
        zwp_input_method_keyboard_grab_v2, zwp_input_method_manager_v2, zwp_input_method_v2,
    },
    zwp_virtual_keyboard_v1::client::{zwp_virtual_keyboard_manager_v1, zwp_virtual_keyboard_v1},
};
use wayland_protocols_wlr::layer_shell::v1::client::{zwlr_layer_shell_v1, zwlr_layer_surface_v1};

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

    /// A window (an xdg toplevel), shown once the compositor has configured and placed it.
    pub fn window(&mut self, app_id: &str, title: &str) {
        let wm_base: xdg_wm_base::XdgWmBase =
            self.globals.bind(&self.qh, 1..=6, ()).expect("xdg_wm_base");
        let surface = self.compositor.create_surface(&self.qh, ());
        let xdg = wm_base.get_xdg_surface(&surface, &self.qh, ());
        let toplevel = xdg.get_toplevel(&self.qh, ());
        toplevel.set_app_id(app_id.into());
        toplevel.set_title(title.into());
        surface.commit();
        self.state.surface = Some(surface);
        self.state.xdg = Some((xdg, toplevel));
        self.roundtrip();
        self.roundtrip();
    }

    /// The window goes away (its client destroys it).
    pub fn close_window(&mut self) {
        if let Some((xdg, toplevel)) = self.state.xdg.take() {
            toplevel.destroy();
            xdg.destroy();
        }
        if let Some(surface) = self.state.surface.take() {
            surface.destroy();
        }
        self.roundtrip();
    }

    /// Lock the session; `locked` once the compositor confirms.
    pub fn lock(&mut self) {
        let manager: ext_session_lock_manager_v1::ExtSessionLockManagerV1 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("ext_session_lock_manager_v1 (the shell's)");
        self.state.lock = Some(manager.lock(&self.qh, ()));
        self.roundtrip();
        assert!(self.state.locked, "the compositor did not lock");
    }

    /// The lock screen's surface on the first screen, drawn at the size asked.
    pub fn lock_surface(&mut self) {
        let output: wl_output::WlOutput =
            self.globals.bind(&self.qh, 1..=4, ()).expect("wl_output");
        let surface = self.compositor.create_surface(&self.qh, ());
        let lock = self.state.lock.as_ref().expect("locked first");
        let lock_surface = lock.get_lock_surface(&surface, &output, &self.qh, ());
        self.state.surface = Some(surface);
        self.state.lock_surface = Some(lock_surface);
        self.roundtrip();
        self.roundtrip();
        assert!(self.state.lock_shown, "the lock surface was not configured");
    }

    pub fn unlock(&mut self) {
        if let Some(lock) = self.state.lock.take() {
            lock.unlock_and_destroy();
        }
        self.roundtrip();
    }

    /// A shell sheet on the overlay layer that takes the keyboard (`exclusive`) or not.
    pub fn sheet(&mut self, exclusive: bool) {
        let shell: zwlr_layer_shell_v1::ZwlrLayerShellV1 = self
            .globals
            .bind(&self.qh, 1..=4, ())
            .expect("zwlr_layer_shell_v1");
        let surface = self.compositor.create_surface(&self.qh, ());
        let layer = shell.get_layer_surface(
            &surface,
            None,
            zwlr_layer_shell_v1::Layer::Overlay,
            "dashi.test-sheet".into(),
            &self.qh,
            (),
        );
        layer.set_size(400, 200);
        let keyboard = if exclusive {
            zwlr_layer_surface_v1::KeyboardInteractivity::Exclusive
        } else {
            zwlr_layer_surface_v1::KeyboardInteractivity::None
        };
        layer.set_keyboard_interactivity(keyboard);
        surface.commit();
        self.state.surface = Some(surface);
        self.state.layer = Some(layer);
        self.roundtrip();
        self.roundtrip();
        // A commit after the first configure is when one that is exclusive asks for the keyboard.
        if let Some(surface) = &self.state.surface {
            surface.commit();
        }
        self.roundtrip();
    }

    /// The sheet goes away (its client destroys it, as a Metal host hiding it does).
    pub fn close_sheet(&mut self) {
        if let Some(layer) = self.state.layer.take() {
            layer.destroy();
        }
        if let Some(surface) = self.state.surface.take() {
            surface.destroy();
        }
        self.roundtrip();
    }

    /// The window asks for the keyboard with a token of its own that names no surface
    /// (xdg-activation), as an app that brings itself forward does.
    pub fn activate_self(&mut self) {
        let activation: xdg_activation_v1::XdgActivationV1 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("xdg_activation_v1");
        let token = activation.get_activation_token(&self.qh, ());
        token.commit();
        self.roundtrip();
        let token = self.state.token.take().expect("an activation token");
        let surface = self.state.surface.as_ref().expect("a window first");
        activation.activate(token, surface);
        self.roundtrip();
    }

    /// Be the seat's input method and grab its keyboard, as fcitx5 does while a field is active.
    #[allow(dead_code)] // tests/agent_keys.rs; the lock tests don't.
    pub fn grab_keyboard_as_input_method(&mut self) {
        let manager: zwp_input_method_manager_v2::ZwpInputMethodManagerV2 = self
            .globals
            .bind(&self.qh, 1..=1, ())
            .expect("zwp_input_method_manager_v2 (the shell's)");
        let method = manager.get_input_method(&self.seat, &self.qh, ());
        let grab = method.grab_keyboard(&self.qh, ());
        self.state.input_method = Some((method, grab));
        self.roundtrip();
    }

    /// Press and release `key` (evdev) on a virtual keyboard: it goes to whatever has the keyboard.
    pub fn type_key(&mut self, key: u32) {
        if self.state.keyboard_typist.is_none() {
            let manager: zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1 = self
                .globals
                .bind(&self.qh, 1..=1, ())
                .expect("zwp_virtual_keyboard_manager_v1 (the shell's)");
            let keyboard = manager.create_virtual_keyboard(&self.seat, &self.qh, ());
            let mut file = tempfile::tempfile().expect("a keymap file");
            let keymap = concat!(
                "xkb_keymap { xkb_keycodes { include \"evdev+aliases(qwerty)\" }; ",
                "xkb_types { include \"complete\" }; xkb_compat { include \"complete\" }; ",
                "xkb_symbols { include \"pc+us+inet(evdev)\" }; };\0"
            );
            file.write_all(keymap.as_bytes()).expect("the keymap");
            keyboard.keymap(1, file.as_fd(), keymap.len() as u32);
            self.state.keyboard_typist = Some(keyboard);
        }
        let keyboard = self.state.keyboard_typist.as_ref().expect("made above");
        keyboard.key(0, key, 1);
        keyboard.key(1, key, 0);
        self.roundtrip();
    }
}

/// Attach a solid buffer `size` big to `surface` and commit it.
fn fill(
    surface: &wl_surface::WlSurface,
    shm: &wl_shm::WlShm,
    (width, height): (i32, i32),
    qh: &QueueHandle<State>,
) {
    let file = tempfile::tempfile().expect("an shm file");
    file.set_len((width * height * 4) as u64)
        .expect("shm pixels");
    let pool = shm.create_pool(file.as_fd(), width * height * 4, qh, ());
    let buffer = pool.create_buffer(
        0,
        width,
        height,
        width * 4,
        wl_shm::Format::Argb8888,
        qh,
        (),
    );
    pool.destroy();
    surface.attach(Some(&buffer), 0, 0);
    surface.commit();
}

impl Dispatch<wl_keyboard::WlKeyboard, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_keyboard::WlKeyboard,
        event: wl_keyboard::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_keyboard::Event::Enter { .. } => {
                state.enters += 1;
                state.focused = true;
            }
            wl_keyboard::Event::Leave { .. } => {
                state.leaves += 1;
                state.focused = false;
            }
            wl_keyboard::Event::Key {
                key,
                state: WEnum::Value(wl_keyboard::KeyState::Pressed),
                ..
            } => state.keys.push(key),
            _ => {}
        }
    }
}

impl Dispatch<xdg_surface::XdgSurface, ()> for State {
    fn event(
        state: &mut Self,
        xdg: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            xdg.ack_configure(serial);
            if !state.shown
                && let (Some(surface), Some(shm)) = (&state.surface, &state.shm)
            {
                fill(surface, shm, (320, 200), qh);
                state.shown = true;
            }
        }
    }
}

impl Dispatch<ext_session_lock_v1::ExtSessionLockV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &ext_session_lock_v1::ExtSessionLockV1,
        event: ext_session_lock_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            ext_session_lock_v1::Event::Locked => state.locked = true,
            ext_session_lock_v1::Event::Finished => state.finished = true,
            _ => {}
        }
    }
}

impl Dispatch<ext_session_lock_surface_v1::ExtSessionLockSurfaceV1, ()> for State {
    fn event(
        state: &mut Self,
        lock_surface: &ext_session_lock_surface_v1::ExtSessionLockSurfaceV1,
        event: ext_session_lock_surface_v1::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        if let ext_session_lock_surface_v1::Event::Configure {
            serial,
            width,
            height,
        } = event
        {
            lock_surface.ack_configure(serial);
            if let (Some(surface), Some(shm)) = (&state.surface, &state.shm) {
                fill(surface, shm, (width as i32, height as i32), qh);
                state.lock_shown = true;
            }
        }
    }
}

impl Dispatch<zwlr_layer_surface_v1::ZwlrLayerSurfaceV1, ()> for State {
    fn event(
        state: &mut Self,
        layer: &zwlr_layer_surface_v1::ZwlrLayerSurfaceV1,
        event: zwlr_layer_surface_v1::Event,
        _: &(),
        _: &Connection,
        qh: &QueueHandle<Self>,
    ) {
        match event {
            zwlr_layer_surface_v1::Event::Configure {
                serial,
                width,
                height,
            } => {
                layer.ack_configure(serial);
                if let (Some(surface), Some(shm)) = (&state.surface, &state.shm) {
                    fill(
                        surface,
                        shm,
                        (width.max(1) as i32, height.max(1) as i32),
                        qh,
                    );
                    state.layer_shown = true;
                }
            }
            zwlr_layer_surface_v1::Event::Closed => state.layer_closed = true,
            _ => {}
        }
    }
}

impl Dispatch<xdg_activation_token_v1::XdgActivationTokenV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &xdg_activation_token_v1::XdgActivationTokenV1,
        event: xdg_activation_token_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_activation_token_v1::Event::Done { token } = event {
            state.token = Some(token);
        }
    }
}

impl Dispatch<xdg_wm_base::XdgWmBase, ()> for State {
    fn event(
        _: &mut Self,
        base: &xdg_wm_base::XdgWmBase,
        event: xdg_wm_base::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_wm_base::Event::Ping { serial } = event {
            base.pong(serial);
        }
    }
}

impl Dispatch<wl_registry::WlRegistry, GlobalListContents> for State {
    fn event(
        _: &mut Self,
        _: &wl_registry::WlRegistry,
        _: wl_registry::Event,
        _: &GlobalListContents,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
    }
}

delegate_noop!(State: ignore wl_compositor::WlCompositor);
delegate_noop!(State: ignore wl_seat::WlSeat);
delegate_noop!(State: ignore wl_surface::WlSurface);
delegate_noop!(State: ignore wl_shm::WlShm);
delegate_noop!(State: ignore wl_shm_pool::WlShmPool);
delegate_noop!(State: ignore wl_buffer::WlBuffer);
delegate_noop!(State: ignore wl_output::WlOutput);
delegate_noop!(State: ignore xdg_toplevel::XdgToplevel);
delegate_noop!(State: ignore ext_session_lock_manager_v1::ExtSessionLockManagerV1);
delegate_noop!(State: ignore zwlr_layer_shell_v1::ZwlrLayerShellV1);
delegate_noop!(State: ignore xdg_activation_v1::XdgActivationV1);
delegate_noop!(State: ignore zwp_virtual_keyboard_manager_v1::ZwpVirtualKeyboardManagerV1);
delegate_noop!(State: ignore zwp_virtual_keyboard_v1::ZwpVirtualKeyboardV1);

impl Dispatch<zwp_input_method_keyboard_grab_v2::ZwpInputMethodKeyboardGrabV2, ()> for State {
    fn event(
        state: &mut Self,
        _: &zwp_input_method_keyboard_grab_v2::ZwpInputMethodKeyboardGrabV2,
        event: zwp_input_method_keyboard_grab_v2::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let zwp_input_method_keyboard_grab_v2::Event::Key {
            key,
            state: WEnum::Value(wl_keyboard::KeyState::Pressed),
            ..
        } = event
        {
            state.input_method_keys.push(key);
        }
    }
}

delegate_noop!(State: ignore zwp_input_method_manager_v2::ZwpInputMethodManagerV2);
delegate_noop!(State: ignore zwp_input_method_v2::ZwpInputMethodV2);
