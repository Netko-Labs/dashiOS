//! What a listening test window's keyboard hears: whether it has the
//! keyboard, how often it got it, its keys in order and its last modifiers.

use wayland_client::{Connection, Dispatch, QueueHandle, WEnum, protocol::wl_keyboard};

use super::State;

#[derive(Default)]
pub struct Heard {
    /// The keyboard is in the window (entered and not left).
    pub focused: bool,
    pub enters: usize,
    /// Each key as it came: its evdev code, pressed or let go.
    pub keys: Vec<(u32, bool)>,
    /// The modifiers held down, as last said.
    pub depressed: u32,
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
        let heard = &mut state.keyboard;
        match event {
            wl_keyboard::Event::Enter { .. } => {
                heard.focused = true;
                heard.enters += 1;
            }
            wl_keyboard::Event::Leave { .. } => heard.focused = false,
            wl_keyboard::Event::Key {
                key,
                state: WEnum::Value(pressed),
                ..
            } => heard
                .keys
                .push((key, pressed == wl_keyboard::KeyState::Pressed)),
            wl_keyboard::Event::Modifiers { mods_depressed, .. } => {
                heard.depressed = mods_depressed;
            }
            _ => {}
        }
    }
}
