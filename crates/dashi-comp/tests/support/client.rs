//! A minimal Wayland client for the tests: one xdg toplevel that draws a
//! solid shm buffer once it is configured; a movable one asks to be moved
//! (xdg_toplevel.move) when a button is pressed in it, as apps that draw
//! their own title bars do; a listening one only notes what its pointer hears
//! (client/pointer.rs); a locking one locks the pointer (client/lock.rs). It can open dialogs too: more toplevels whose xdg
//! parent is the first.

mod keyboard;
mod lock;
mod pointer;

use std::{io::Write, os::fd::AsFd, path::Path};

use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, delegate_noop,
    globals::{GlobalListContents, registry_queue_init},
    protocol::{wl_buffer, wl_compositor, wl_registry, wl_seat, wl_shm, wl_shm_pool, wl_surface},
};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};

pub struct Client {
    globals: wayland_client::globals::GlobalList,
    queue: EventQueue<State>,
    pub state: State,
    compositor: wl_compositor::WlCompositor,
    wm_base: xdg_wm_base::XdgWmBase,
    toplevel: xdg_toplevel::XdgToplevel,
}

/// A dialog's surface, drawn once configured.
struct Dialog {
    surface: wl_surface::WlSurface,
    configured: bool,
    drawn: bool,
}

#[derive(Default)]
pub struct State {
    pub configured: bool,
    pub closed: bool,
    surface: Option<wl_surface::WlSurface>,
    shm: Option<wl_shm::WlShm>,
    drawn: bool,
    /// Set for a movable window: a press asks to move it.
    mover: Option<(wl_seat::WlSeat, xdg_toplevel::XdgToplevel)>,
    /// Moves asked for.
    pub moves: usize,
    /// The pointer is over the window (entered and not left; a movable or listening window's).
    pub pointer_in: bool,
    /// What the pointer heard, in order: its buttons (pressed or let go) and how often it moved.
    pub buttons: Vec<bool>,
    pub motions: usize,
    /// What a locking window's lock heard, in order: it took hold (true) or let go.
    pub locks: Vec<bool>,
    /// What a listening window's keyboard heard.
    pub keyboard: keyboard::Heard,
    /// A listening window's seat, kept so its pointer and keyboard live.
    listens: Option<wl_seat::WlSeat>,
    /// Dialogs opened (`open_dialog`), by their xdg_surface's number (1 on).
    dialogs: Vec<Dialog>,
}

impl Client {
    /// Connect to the compositor at `runtime_dir/display` and open a window.
    pub fn open(runtime_dir: &Path, display: &str, app_id: &str, title: &str) -> Self {
        Self::open_with(runtime_dir, display, app_id, title, false)
    }

    /// A window that asks to be moved when a button is pressed in it.
    pub fn open_movable(runtime_dir: &Path, display: &str, app_id: &str, title: &str) -> Self {
        Self::open_with(runtime_dir, display, app_id, title, true)
    }

    /// A window that hears the pointer (`state.buttons`, `state.motions`) and does nothing with it.
    pub fn open_listening(runtime_dir: &Path, display: &str, app_id: &str, title: &str) -> Self {
        let mut client = Self::open(runtime_dir, display, app_id, title);
        let stream = client.queue.handle();
        let seat: wl_seat::WlSeat = client.globals.bind(&stream, 1..=7, ()).expect("wl_seat");
        seat.get_pointer(&stream, ());
        seat.get_keyboard(&stream, ());
        client.state.listens = Some(seat);
        client.roundtrip();
        client
    }

    /// Hear everything the compositor has sent so far.
    pub fn roundtrip(&mut self) {
        self.queue.roundtrip(&mut self.state).expect("a roundtrip");
    }

    fn open_with(
        runtime_dir: &Path,
        display: &str,
        app_id: &str,
        title: &str,
        movable: bool,
    ) -> Self {
        let stream = std::os::unix::net::UnixStream::connect(runtime_dir.join(display))
            .expect("the Wayland socket");
        let connection = Connection::from_socket(stream).expect("a Wayland connection");
        let (globals, mut queue) = registry_queue_init::<State>(&connection).expect("the registry");
        let qh = queue.handle();
        let compositor: wl_compositor::WlCompositor =
            globals.bind(&qh, 4..=6, ()).expect("wl_compositor");
        let shm: wl_shm::WlShm = globals.bind(&qh, 1..=1, ()).expect("wl_shm");
        let wm_base: xdg_wm_base::XdgWmBase = globals.bind(&qh, 1..=6, ()).expect("xdg_wm_base");
        let surface = compositor.create_surface(&qh, ());
        let xdg = wm_base.get_xdg_surface(&surface, &qh, 0);
        let toplevel = xdg.get_toplevel(&qh, ());
        toplevel.set_app_id(app_id.into());
        toplevel.set_title(title.into());
        surface.commit();
        let mover = movable.then(|| {
            let seat: wl_seat::WlSeat = globals.bind(&qh, 1..=7, ()).expect("wl_seat");
            seat.get_pointer(&qh, ());
            (seat, toplevel.clone())
        });
        let mut state = State {
            surface: Some(surface),
            shm: Some(shm),
            mover,
            ..State::default()
        };
        queue.roundtrip(&mut state).expect("a roundtrip");
        Self {
            globals,
            queue,
            state,
            compositor,
            wm_base,
            toplevel,
        }
    }

    /// Open a dialog of the first window: a toplevel whose xdg parent it is.
    pub fn open_dialog(&mut self, title: &str) {
        let qh = self.queue.handle();
        let surface = self.compositor.create_surface(&qh, ());
        let number = self.state.dialogs.len() + 1;
        let xdg = self.wm_base.get_xdg_surface(&surface, &qh, number);
        let toplevel = xdg.get_toplevel(&qh, ());
        toplevel.set_parent(Some(&self.toplevel));
        toplevel.set_title(title.into());
        surface.commit();
        self.state.dialogs.push(Dialog {
            surface,
            configured: false,
            drawn: false,
        });
        self.queue.flush().ok();
    }

    /// Handle what the compositor sent (drawing once configured).
    pub fn dispatch(&mut self) {
        self.queue.flush().ok();
        if let Some(guard) = self.queue.prepare_read() {
            let _ = guard.read();
        }
        self.queue
            .dispatch_pending(&mut self.state)
            .expect("dispatch");
        let qh = self.queue.handle();
        self.state.draw(&qh);
        self.queue.flush().ok();
    }
}

impl State {
    fn draw(&mut self, qh: &QueueHandle<State>) {
        let Some(shm) = self.shm.clone() else {
            return;
        };
        for dialog in &mut self.dialogs {
            if dialog.configured && !dialog.drawn {
                fill(&dialog.surface, &shm, (240, 120), qh);
                dialog.drawn = true;
            }
        }
        if !self.configured || self.drawn {
            return;
        }
        let Some(surface) = &self.surface else {
            return;
        };
        fill(surface, &shm, (320, 200), qh);
        self.drawn = true;
    }
}

/// Attach a solid buffer `size` big to `surface` and commit it.
fn fill(
    surface: &wl_surface::WlSurface,
    shm: &wl_shm::WlShm,
    size: (i32, i32),
    qh: &QueueHandle<State>,
) {
    let (width, height) = size;
    let mut file = tempfile::tempfile().expect("an shm file");
    let pixels = vec![0x80u8; (width * height * 4) as usize];
    file.write_all(&pixels).expect("shm pixels");
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
    surface.attach(Some(&buffer), 0, 0);
    surface.commit();
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

/// An xdg_surface's number: 0 is the first window, 1 on its dialogs.
impl Dispatch<xdg_surface::XdgSurface, usize> for State {
    fn event(
        state: &mut Self,
        xdg: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        number: &usize,
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            xdg.ack_configure(serial);
            match number.checked_sub(1) {
                None => state.configured = true,
                Some(at) => {
                    if let Some(dialog) = state.dialogs.get_mut(at) {
                        dialog.configured = true;
                    }
                }
            }
        }
    }
}

impl Dispatch<xdg_toplevel::XdgToplevel, ()> for State {
    fn event(
        state: &mut Self,
        _: &xdg_toplevel::XdgToplevel,
        event: xdg_toplevel::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_toplevel::Event::Close = event {
            state.closed = true;
        }
    }
}

delegate_noop!(State: ignore wl_compositor::WlCompositor);
delegate_noop!(State: ignore wl_seat::WlSeat);
delegate_noop!(State: ignore wl_surface::WlSurface);
delegate_noop!(State: ignore wl_shm::WlShm);
delegate_noop!(State: ignore wl_shm_pool::WlShmPool);
delegate_noop!(State: ignore wl_buffer::WlBuffer);

/// The globals a plain client (not the shell) is shown, by interface name.
pub fn globals(runtime_dir: &Path, display: &str) -> Vec<String> {
    let stream = std::os::unix::net::UnixStream::connect(runtime_dir.join(display))
        .expect("the Wayland socket");
    let connection = Connection::from_socket(stream).expect("a Wayland connection");
    let (globals, _queue) = registry_queue_init::<State>(&connection).expect("the registry");
    globals
        .contents()
        .clone_list()
        .into_iter()
        .map(|global| global.interface)
        .collect()
}
