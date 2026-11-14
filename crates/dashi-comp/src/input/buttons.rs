//! A pointer button: the overview, a title bar or resize border, a sheet,
//! or the client under the pointer gets it.

use smithay::{
    backend::input::{ButtonState, Event, InputBackend, PointerButtonEvent},
    input::pointer::{ButtonEvent, MotionEvent, PointerHandle},
    utils::{Logical, Point, SERIAL_COUNTER},
};

use crate::state::Dashi;

impl Dashi {
    pub(super) fn on_pointer_button<I: InputBackend>(&mut self, event: &I::PointerButtonEvent) {
        let Some(pointer) = self.seat.get_pointer() else {
            return;
        };
        let serial = SERIAL_COUNTER.next_serial();
        let button = event.button_code();
        let button_state = event.state();
        let pressed = button_state == ButtonState::Pressed;
        if pressed {
            self.note_chord();
            // A click under a key heard as held (⌥-click) makes it a modifier too (keys/held.rs).
            self.held_keys_chorded();
            // A click may move the caret: what was typed is no longer before it.
            self.keys.snippets.reset();
        }
        let at = pointer.current_location();
        // A drag that started on the overview ends there, over the shell's row too.
        let overview_release = !pressed && self.overview_pressed();
        if self.overview_open() && (overview_release || !self.top_layer_at(at)) {
            if pressed {
                self.overview_press(at);
            } else {
                self.overview_release(at);
                self.return_super(button);
            }
            return;
        }
        let free = pressed && !pointer.is_grabbed();
        // A press on a title bar or a traffic light is the compositor's, not a client's.
        let on_decoration = free && self.decoration_at(at).is_some();
        // So is a press on the resize border around a window Dashi frames.
        let on_border = free && !on_decoration && self.resize_edge_at(at).is_some();
        // A press in a window with a sheet on it brings the sheet forward and
        // goes no further; so does its release (wm/sheets.rs).
        if free && !on_decoration && !on_border && self.sheet_takes_press(at).is_some() {
            self.focus_at(at, serial);
            self.swallowed_buttons.push(button);
            return;
        }
        if !pressed && let Some(held) = self.swallowed_buttons.iter().position(|b| *b == button) {
            self.swallowed_buttons.remove(held);
            self.return_super(button);
            return;
        }
        if free && !on_decoration && !on_border {
            self.focus_at(at, serial);
            // The press goes to what is under the pointer now, even if that
            // appeared under a still pointer (a sheet where the last one was):
            // pointer focus moves only on motion, and input-origin already
            // counts this press as the new surface's.
            self.refresh_pointer_focus(&pointer, at, event.time_msec());
        }
        if pressed && !on_decoration && !on_border {
            // A ❖-click: the window hears Super with it (keys/super_click.rs).
            self.lend_super(button);
        }
        pointer.button(
            self,
            &ButtonEvent {
                button,
                state: button_state,
                serial,
                time: event.time_msec(),
            },
        );
        if on_decoration {
            // After the button is down, so a move grab sees it held.
            self.press_decoration(at, button, serial);
        }
        if on_border {
            self.press_resize_edge(at, button, serial);
        }
        if !pressed {
            // After the release, so the click still had Super.
            self.return_super(button);
        }
        if !pressed && !pointer.is_grabbed() {
            // A resize just ended: the cursor is what the pointer is over again.
            self.hover_resize_edges(at);
        }
        pointer.frame(self);
    }

    /// If the surface under the pointer is no longer the one it last entered
    /// (one appeared or went away under it), enter the new one where the pointer is.
    pub(super) fn refresh_pointer_focus(
        &mut self,
        pointer: &PointerHandle<Self>,
        at: Point<f64, Logical>,
        time: u32,
    ) {
        if pointer.is_grabbed() {
            return;
        }
        let under = self.surface_under(at);
        if pointer.current_focus() == under.as_ref().map(|(surface, _)| surface.clone()) {
            return;
        }
        pointer.motion(
            self,
            under,
            &MotionEvent {
                location: at,
                serial: SERIAL_COUNTER.next_serial(),
                time,
            },
        );
        pointer.frame(self);
    }
}
