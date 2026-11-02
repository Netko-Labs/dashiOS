//! Keyboard and pointer input to the focused client. Adapted from smithay's
//! smallvil example (MIT, github.com/Smithay/smithay, v0.7.0). C1 adds the
//! keymap, bindings, and ❖ (docs/compositor.md).

mod decorations;

use smithay::{
    backend::input::{
        AbsolutePositionEvent, Axis, AxisSource, ButtonState, Event, InputBackend, InputEvent,
        KeyboardKeyEvent, PointerAxisEvent, PointerButtonEvent, PointerMotionEvent,
    },
    input::pointer::{AxisFrame, ButtonEvent, MotionEvent, RelativeMotionEvent},
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    pub(crate) fn process_input_event<I: InputBackend>(&mut self, event: InputEvent<I>) {
        match event {
            InputEvent::Keyboard { event, .. } => {
                self.on_key(event.key_code(), event.state(), Event::time_msec(&event));
            }
            InputEvent::PointerMotion { event, .. } => {
                let Some(pointer) = self.seat.get_pointer() else {
                    return;
                };
                let from = pointer.current_location();
                let to = self.clamp_to_screens(from + event.delta());
                let under = self.surface_under(to);
                let serial = SERIAL_COUNTER.next_serial();
                pointer.motion(
                    self,
                    under.clone(),
                    &MotionEvent {
                        location: to,
                        serial,
                        time: event.time_msec(),
                    },
                );
                pointer.relative_motion(
                    self,
                    under,
                    &RelativeMotionEvent {
                        delta: event.delta(),
                        delta_unaccel: event.delta_unaccel(),
                        utime: event.time(),
                    },
                );
                pointer.frame(self);
                self.watch_bars(to);
                self.overview_motion(to);
            }
            InputEvent::PointerMotionAbsolute { event, .. } => {
                let Some(output_geo) = self
                    .space
                    .outputs()
                    .next()
                    .and_then(|output| self.space.output_geometry(output))
                else {
                    return;
                };

                let pos = event.position_transformed(output_geo.size) + output_geo.loc.to_f64();

                let serial = SERIAL_COUNTER.next_serial();

                let Some(pointer) = self.seat.get_pointer() else {
                    return;
                };

                let under = self.surface_under(pos);

                pointer.motion(
                    self,
                    under,
                    &MotionEvent {
                        location: pos,
                        serial,
                        time: event.time_msec(),
                    },
                );
                pointer.frame(self);
                self.watch_bars(pos);
                self.overview_motion(pos);
            }
            InputEvent::PointerButton { event, .. } => {
                let Some(pointer) = self.seat.get_pointer() else {
                    return;
                };
                let serial = SERIAL_COUNTER.next_serial();
                let button = event.button_code();
                let button_state = event.state();
                let pressed = button_state == ButtonState::Pressed;
                if pressed {
                    self.note_chord();
                }
                let at = pointer.current_location();
                if self.overview_open() && !self.top_layer_at(at) {
                    if pressed {
                        self.overview_press(at);
                    } else {
                        self.overview_release(at);
                    }
                    return;
                }
                let free = pressed && !pointer.is_grabbed();
                // A press on a title bar or a traffic light is the compositor's, not a client's.
                let on_decoration = free && self.decoration_at(at).is_some();
                if free && !on_decoration {
                    self.focus_at(at, serial);
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
                pointer.frame(self);
            }
            InputEvent::PointerAxis { event, .. } => {
                let source = event.source();

                let horizontal_amount = event.amount(Axis::Horizontal).unwrap_or_else(|| {
                    event.amount_v120(Axis::Horizontal).unwrap_or(0.0) * 15.0 / 120.
                });
                let vertical_amount = event.amount(Axis::Vertical).unwrap_or_else(|| {
                    event.amount_v120(Axis::Vertical).unwrap_or(0.0) * 15.0 / 120.
                });
                let horizontal_amount_discrete = event.amount_v120(Axis::Horizontal);
                let vertical_amount_discrete = event.amount_v120(Axis::Vertical);

                let mut frame = AxisFrame::new(event.time_msec()).source(source);
                if horizontal_amount != 0.0 {
                    frame = frame.value(Axis::Horizontal, horizontal_amount);
                    if let Some(discrete) = horizontal_amount_discrete {
                        frame = frame.v120(Axis::Horizontal, discrete as i32);
                    }
                }
                if vertical_amount != 0.0 {
                    frame = frame.value(Axis::Vertical, vertical_amount);
                    if let Some(discrete) = vertical_amount_discrete {
                        frame = frame.v120(Axis::Vertical, discrete as i32);
                    }
                }

                if source == AxisSource::Finger {
                    if event.amount(Axis::Horizontal) == Some(0.0) {
                        frame = frame.stop(Axis::Horizontal);
                    }
                    if event.amount(Axis::Vertical) == Some(0.0) {
                        frame = frame.stop(Axis::Vertical);
                    }
                }

                let Some(pointer) = self.seat.get_pointer() else {
                    return;
                };
                pointer.axis(self, frame);
                pointer.frame(self);
            }
            _ => {}
        }
    }
}
