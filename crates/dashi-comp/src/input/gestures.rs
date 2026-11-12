//! Touchpad gestures: a swipe the shell claims (`claims`) goes to it as
//! `gesture` events; every other swipe, and every pinch and hold, goes to the
//! client under the pointer (pointer-gestures).

use crate::ipc::protocol::{Event as IpcEvent, Swipe, SwipePhase};
use smithay::{
    backend::input::{
        Event, GestureBeginEvent, GestureEndEvent, GesturePinchUpdateEvent as _,
        GestureSwipeUpdateEvent as _, InputBackend,
    },
    input::pointer::{
        GestureHoldBeginEvent, GestureHoldEndEvent, GesturePinchBeginEvent, GesturePinchEndEvent,
        GesturePinchUpdateEvent, GestureSwipeBeginEvent, GestureSwipeEndEvent,
        GestureSwipeUpdateEvent,
    },
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    pub(super) fn on_swipe_begin<I: InputBackend>(&mut self, event: &I::GestureSwipeBeginEvent) {
        if self.claims_swipe(event.fingers()) {
            self.claims.swiping = true;
            self.ipc.emit(IpcEvent::Gesture {
                kind: Swipe::Swipe,
                phase: SwipePhase::Begin {
                    fingers: event.fingers(),
                },
            });
        } else if let Some(pointer) = self.seat.get_pointer() {
            let swipe = GestureSwipeBeginEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                fingers: event.fingers(),
            };
            pointer.gesture_swipe_begin(self, &swipe);
        }
    }

    pub(super) fn on_swipe_update<I: InputBackend>(&mut self, event: &I::GestureSwipeUpdateEvent) {
        if self.claims.swiping {
            let delta = event.delta();
            self.ipc.emit(IpcEvent::Gesture {
                kind: Swipe::Swipe,
                phase: SwipePhase::Update {
                    dx: delta.x,
                    dy: delta.y,
                },
            });
        } else if let Some(pointer) = self.seat.get_pointer() {
            let update = GestureSwipeUpdateEvent {
                time: event.time_msec(),
                delta: event.delta(),
            };
            pointer.gesture_swipe_update(self, &update);
        }
    }

    pub(super) fn on_swipe_end<I: InputBackend>(&mut self, event: &I::GestureSwipeEndEvent) {
        if std::mem::take(&mut self.claims.swiping) {
            self.ipc.emit(IpcEvent::Gesture {
                kind: Swipe::Swipe,
                phase: SwipePhase::End {
                    cancelled: event.cancelled(),
                },
            });
        } else if let Some(pointer) = self.seat.get_pointer() {
            let end = GestureSwipeEndEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                cancelled: event.cancelled(),
            };
            pointer.gesture_swipe_end(self, &end);
        }
    }

    pub(super) fn on_pinch_begin<I: InputBackend>(&mut self, event: &I::GesturePinchBeginEvent) {
        if let Some(pointer) = self.seat.get_pointer() {
            let begin = GesturePinchBeginEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                fingers: event.fingers(),
            };
            pointer.gesture_pinch_begin(self, &begin);
        }
    }

    pub(super) fn on_pinch_update<I: InputBackend>(&mut self, event: &I::GesturePinchUpdateEvent) {
        if let Some(pointer) = self.seat.get_pointer() {
            let update = GesturePinchUpdateEvent {
                time: event.time_msec(),
                delta: event.delta(),
                scale: event.scale(),
                rotation: event.rotation(),
            };
            pointer.gesture_pinch_update(self, &update);
        }
    }

    pub(super) fn on_pinch_end<I: InputBackend>(&mut self, event: &I::GesturePinchEndEvent) {
        if let Some(pointer) = self.seat.get_pointer() {
            let end = GesturePinchEndEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                cancelled: event.cancelled(),
            };
            pointer.gesture_pinch_end(self, &end);
        }
    }

    pub(super) fn on_hold_begin<I: InputBackend>(&mut self, event: &I::GestureHoldBeginEvent) {
        if let Some(pointer) = self.seat.get_pointer() {
            let begin = GestureHoldBeginEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                fingers: event.fingers(),
            };
            pointer.gesture_hold_begin(self, &begin);
        }
    }

    pub(super) fn on_hold_end<I: InputBackend>(&mut self, event: &I::GestureHoldEndEvent) {
        if let Some(pointer) = self.seat.get_pointer() {
            let end = GestureHoldEndEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time: event.time_msec(),
                cancelled: event.cancelled(),
            };
            pointer.gesture_hold_end(self, &end);
        }
    }
}
