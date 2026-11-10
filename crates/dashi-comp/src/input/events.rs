//! Every input event, from whichever backend: noted as the person's (idle,
//! session/origin.rs), then handed to what handles its kind.

use smithay::backend::input::{
    ButtonState, Event, InputBackend, InputEvent, KeyboardKeyEvent, PointerButtonEvent,
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
            InputEvent::PointerMotion { event, .. } => self.on_pointer_motion::<I>(&event),
            InputEvent::PointerMotionAbsolute { event, .. } => {
                self.on_pointer_motion_absolute::<I>(&event)
            }
            InputEvent::PointerButton { event, .. } => self.on_pointer_button::<I>(&event),
            InputEvent::PointerAxis { event, .. } => self.on_pointer_axis::<I>(&event),
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
