//! A minimal Wayland client for the tests: one xdg toplevel that draws a
//! solid shm buffer once it is configured; a movable one asks to be moved
//! (xdg_toplevel.move) when a button is pressed in it, as apps that draw
//! their own title bars do.

use std::{io::Write, os::fd::AsFd, path::Path};

use wayland_client::{
    Connection, Dispatch, EventQueue, QueueHandle, delegate_noop,
    globals::{GlobalListContents, registry_queue_init},
    protocol::{
        wl_buffer, wl_compositor, wl_pointer, wl_registry, wl_seat, wl_shm, wl_shm_pool, wl_surface,
    },
};
use wayland_protocols::xdg::shell::client::{xdg_surface, xdg_toplevel, xdg_wm_base};

pub struct Client {
    queue: EventQueue<State>,
    pub state: State,
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
        let xdg = wm_base.get_xdg_surface(&surface, &qh, ());
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
        Self { queue, state }
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
        if !self.configured || self.drawn {
            return;
        }
        let (Some(surface), Some(shm)) = (&self.surface, &self.shm) else {
            return;
        };
        let (width, height) = (320, 200);
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
        self.drawn = true;
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

impl Dispatch<xdg_surface::XdgSurface, ()> for State {
    fn event(
        state: &mut Self,
        xdg: &xdg_surface::XdgSurface,
        event: xdg_surface::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        if let xdg_surface::Event::Configure { serial } = event {
            xdg.ack_configure(serial);
            state.configured = true;
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

impl Dispatch<wl_pointer::WlPointer, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_pointer::WlPointer,
        event: wl_pointer::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        let wl_pointer::Event::Button {
            serial,
            state: wayland_client::WEnum::Value(wl_pointer::ButtonState::Pressed),
            ..
        } = event
        else {
            return;
        };
        if let Some((seat, toplevel)) = &state.mover {
            toplevel._move(seat, serial);
            state.moves += 1;
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
