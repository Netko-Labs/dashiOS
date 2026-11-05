//! Keyboard and pointer input to the focused client. Adapted from smithay's
//! smallvil example (MIT, github.com/Smithay/smithay, v0.7.0). C1 adds the
//! keymap, bindings, and ❖ (docs/compositor.md).

mod claims;
mod constraints;
mod decorations;
mod gestures;
mod resize_edges;
pub(crate) mod settings;

pub(crate) use claims::Claims;

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
        let deliberate = match &event {
            InputEvent::Keyboard { event } => {
                event.state() == smithay::backend::input::KeyState::Pressed
            }
            InputEvent::PointerButton { event } => event.state() == ButtonState::Pressed,
            InputEvent::DeviceAdded { .. } | InputEvent::DeviceRemoved { .. } => return,
            _ => false,
        };
        self.note_input(deliberate);
        // The person's own presses, against what gets them (session/origin.rs);
        // a pointer press goes to what the pointer is over.
        if deliberate {
            let focus = match &event {
                InputEvent::Keyboard { .. } => {
                    self.seat.get_keyboard().and_then(|k| k.current_focus())
                }
                _ => self.seat.get_pointer().and_then(|p| {
                    let at = p.current_location();
                    self.surface_under(at).map(|(surface, _)| surface)
                }),
            };
            self.note_person_press(focus);
        }
        match event {
            InputEvent::Keyboard { event, .. } => {
                self.on_key(event.key_code(), event.state(), Event::time_msec(&event));
            }
            InputEvent::PointerMotion { event, .. } => {
                let Some(pointer) = self.seat.get_pointer() else {
                    return;
                };
                let from = pointer.current_location();
                let under_from = self.surface_under(from);
                let hold = self.hold_at(&pointer, under_from.as_ref(), from);
                pointer.relative_motion(
                    self,
                    under_from,
                    &RelativeMotionEvent {
                        delta: event.delta(),
                        delta_unaccel: event.delta_unaccel(),
                        utime: event.time(),
                    },
                );
                let to = self.clamp_to_screens(from + event.delta());
                let under = self.surface_under(to);
                // A locked or confined pointer goes nowhere it may not.
                if !Self::hold_allows(&hold, to, under.as_ref()) {
                    pointer.frame(self);
                    return;
                }
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
                pointer.frame(self);
                self.activate_hold(&pointer, under.as_ref(), to);
                self.watch_bars(to);
                self.watch_edges(to);
                self.overview_motion(to);
                self.hover_controls(to);
                self.hover_resize_edges(to);
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
                self.watch_edges(pos);
                self.overview_motion(pos);
                self.hover_controls(pos);
                self.hover_resize_edges(pos);
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
                // So is a press on the resize border around a window Dashi frames.
                let on_border = free && !on_decoration && self.resize_edge_at(at).is_some();
                if free && !on_decoration && !on_border {
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
                if on_border {
                    self.press_resize_edge(at, button, serial);
                }
                if !pressed && !pointer.is_grabbed() {
                    // A resize just ended: the cursor is what the pointer is over again.
                    self.hover_resize_edges(at);
                }
                pointer.frame(self);
            }
            InputEvent::PointerAxis { event, .. } => {
                let source = event.source();
                // The person's scroll speed for this kind of device (input/settings.rs).
                let factor = self.scroll_factor(source);

                let horizontal_amount = factor
                    * event.amount(Axis::Horizontal).unwrap_or_else(|| {
                        event.amount_v120(Axis::Horizontal).unwrap_or(0.0) * 15.0 / 120.
                    });
                let vertical_amount = factor
                    * event.amount(Axis::Vertical).unwrap_or_else(|| {
                        event.amount_v120(Axis::Vertical).unwrap_or(0.0) * 15.0 / 120.
                    });
                let horizontal_amount_discrete =
                    event.amount_v120(Axis::Horizontal).map(|v| v * factor);
                let vertical_amount_discrete =
                    event.amount_v120(Axis::Vertical).map(|v| v * factor);

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
            InputEvent::GestureSwipeBegin { event } => self.on_swipe_begin::<I>(&event),
            InputEvent::GestureSwipeUpdate { event } => self.on_swipe_update::<I>(&event),
            InputEvent::GestureSwipeEnd { event } => self.on_swipe_end::<I>(&event),
            InputEvent::GesturePinchBegin { event } => self.on_pinch_begin::<I>(&event),
            InputEvent::GesturePinchUpdate { event } => self.on_pinch_update::<I>(&event),
            InputEvent::GesturePinchEnd { event } => self.on_pinch_end::<I>(&event),
            InputEvent::GestureHoldBegin { event } => self.on_hold_begin::<I>(&event),
            InputEvent::GestureHoldEnd { event } => self.on_hold_end::<I>(&event),
            _ => {}
        }
    }
}
