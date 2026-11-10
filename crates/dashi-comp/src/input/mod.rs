//! Keyboard and pointer input to the focused client. Adapted from smithay's
//! smallvil example (MIT, github.com/Smithay/smithay, v0.7.0). C1 adds the
//! keymap, bindings, and ❖ (docs/compositor.md).

mod buttons;
mod claims;
mod constraints;
mod decorations;
mod follow;
mod gestures;
mod resize_edges;
pub(crate) mod settings;

pub(crate) use claims::Claims;

use smithay::{
    backend::input::{
        AbsolutePositionEvent, Axis, AxisSource, ButtonState, Event, InputBackend, InputEvent,
        KeyboardKeyEvent, PointerAxisEvent, PointerButtonEvent, PointerMotionEvent,
    },
    input::pointer::{AxisFrame, MotionEvent, RelativeMotionEvent},
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    pub(crate) fn process_input_event<I: InputBackend>(&mut self, event: InputEvent<I>) {
        self.wakes.poke();
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
            InputEvent::PointerButton { event, .. } => self.on_pointer_button::<I>(&event),
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
