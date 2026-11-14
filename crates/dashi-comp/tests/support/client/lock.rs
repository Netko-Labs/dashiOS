//! A test window that locks the pointer, as a game does (pointer-constraints):
//! it hears its lock take hold and let go (`state.locks`).

use wayland_client::{Connection, Dispatch, QueueHandle, delegate_noop, protocol::wl_seat};
use wayland_protocols::wp::pointer_constraints::zv1::client::{
    zwp_locked_pointer_v1::{self, ZwpLockedPointerV1},
    zwp_pointer_constraints_v1::{Lifetime, ZwpPointerConstraintsV1},
};

use super::{Client, State};

impl Client {
    /// A listening window that asks for a lock on the pointer that lasts (as GLFW and Xwayland ask).
    pub fn open_locking(
        runtime_dir: &std::path::Path,
        display: &str,
        app_id: &str,
        title: &str,
    ) -> Self {
        let mut client = Self::open(runtime_dir, display, app_id, title);
        let qh = client.queue.handle();
        let seat: wl_seat::WlSeat = client.globals.bind(&qh, 1..=7, ()).expect("wl_seat");
        let pointer = seat.get_pointer(&qh, ());
        seat.get_keyboard(&qh, ());
        let constraints: ZwpPointerConstraintsV1 = client
            .globals
            .bind(&qh, 1..=1, ())
            .expect("zwp_pointer_constraints_v1");
        if let Some(surface) = &client.state.surface {
            constraints.lock_pointer(surface, &pointer, None, Lifetime::Persistent, &qh, ());
        }
        client.state.listens = Some(seat);
        client.roundtrip();
        client
    }
}

impl Dispatch<ZwpLockedPointerV1, ()> for State {
    fn event(
        state: &mut Self,
        _: &ZwpLockedPointerV1,
        event: zwp_locked_pointer_v1::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            zwp_locked_pointer_v1::Event::Locked => state.locks.push(true),
            zwp_locked_pointer_v1::Event::Unlocked => state.locks.push(false),
            _ => {}
        }
    }
}

delegate_noop!(State: ignore ZwpPointerConstraintsV1);
