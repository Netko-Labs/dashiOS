//! What a test window's pointer hears: whether it is over the window, its
//! buttons and moves in order; a movable window asks to be moved on a press.

use wayland_client::{Connection, Dispatch, QueueHandle, WEnum, protocol::wl_pointer};

use super::State;

impl Dispatch<wl_pointer::WlPointer, ()> for State {
    fn event(
        state: &mut Self,
        _: &wl_pointer::WlPointer,
        event: wl_pointer::Event,
        _: &(),
        _: &Connection,
        _: &QueueHandle<Self>,
    ) {
        match event {
            wl_pointer::Event::Enter { .. } => state.pointer_in = true,
            wl_pointer::Event::Leave { .. } => state.pointer_in = false,
            wl_pointer::Event::Motion { .. } => state.motions += 1,
            wl_pointer::Event::Button {
                serial,
                state: WEnum::Value(pressed),
                ..
            } => {
                let pressed = pressed == wl_pointer::ButtonState::Pressed;
                state.buttons.push(pressed);
                if let (true, Some((seat, toplevel))) = (pressed, &state.mover) {
                    toplevel._move(seat, serial);
                    state.moves += 1;
                }
            }
            _ => {}
        }
    }
}
