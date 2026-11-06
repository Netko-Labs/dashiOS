//! Adapted from smithay's smallvil example (MIT, github.com/Smithay/smithay, v0.7.0).
//!
//! The held window (`Dashi::held`) goes along when the Space changes
//! (spaces.rs); against a screen edge it starts a hold (edge_hold.rs).
//! It stays put until the pointer has gone a few points from the press (a
//! click, or the first press of a double-click, moves nothing); then the
//! shell hears the drag began (`window-grab`) and may frame the window anew
//! (a tiled one gets its own size back), and the grab holds it from there.

use crate::{
    state::Dashi,
    wm::{Shown, frame_to_be, rect_json},
};
use serde_json::json;
use smithay::{
    desktop::Window,
    input::pointer::{
        AxisFrame, ButtonEvent, Focus, GestureHoldBeginEvent, GestureHoldEndEvent,
        GesturePinchBeginEvent, GesturePinchEndEvent, GesturePinchUpdateEvent,
        GestureSwipeBeginEvent, GestureSwipeEndEvent, GestureSwipeUpdateEvent,
        GrabStartData as PointerGrabStartData, MotionEvent, PointerGrab, PointerHandle,
        PointerInnerHandle, RelativeMotionEvent,
    },
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point, Serial},
};

/// How far (logical points) the pointer goes from the press before the window moves.
const DRAG_SLOP: f64 = 4.0;

pub struct MoveSurfaceGrab {
    pub start_data: PointerGrabStartData<Dashi>,
    pub window: Window,
    pub initial_window_location: Point<i32, Logical>,
    /// Past the slop: the window follows the pointer.
    pub moving: bool,
}

/// Whether the pointer at `at` has gone far enough from `press` to be a drag.
fn past_slop(press: Point<f64, Logical>, at: Point<f64, Logical>) -> bool {
    let (dx, dy) = (at.x - press.x, at.y - press.y);
    dx * dx + dy * dy >= DRAG_SLOP * DRAG_SLOP
}

impl Dashi {
    /// Start moving `window` with the pointer: it is the held window until the grab ends.
    pub(crate) fn begin_move(
        &mut self,
        pointer: &PointerHandle<Dashi>,
        start_data: PointerGrabStartData<Dashi>,
        window: Window,
        initial_window_location: Point<i32, Logical>,
        serial: Serial,
    ) {
        let held = self.windows.by_window(&window).map(|entry| entry.id);
        let grab = MoveSurfaceGrab {
            start_data,
            window,
            initial_window_location,
            moving: false,
        };
        pointer.set_grab(self, grab, serial, Focus::Clear);
        // After set_grab: it unsets the grab it replaces, which lets go of what that held.
        self.held = held;
        self.held_reframed = false;
    }

    /// The person began to move or resize `window` from `pointer`: the shell
    /// hears it, with the frame the window had then, at the size its app was
    /// asked to take if it has not drawn that yet (`window-grab`).
    pub(crate) fn report_grab(
        &mut self,
        window: &Window,
        kind: &str,
        pointer: Point<f64, Logical>,
    ) {
        let (Some(id), Some(frame)) = (
            self.windows.by_window(window).map(|entry| entry.id),
            frame_to_be(self, window),
        ) else {
            return;
        };
        // Moved or resized by hand, a tile is a tile no more.
        if let Some(entry) = self.windows.get_mut(id) {
            entry.tiled = false;
        }
        self.ipc.emit(
            "window-grab",
            json!({
                "window": id,
                "kind": kind,
                "frame": rect_json(frame),
                "pointer": { "x": pointer.x, "y": pointer.y },
            }),
        );
    }

    /// Whether the held window can still be moved: on screen, on the Space that shows.
    fn holds_on_screen(&self, window: &Window) -> bool {
        self.windows
            .by_window(window)
            .is_some_and(|entry| entry.shown == Shown::Normal && entry.space == self.spaces.current)
    }
}

impl PointerGrab<Dashi> for MoveSurfaceGrab {
    fn motion(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        _focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &MotionEvent,
    ) {
        // While the grab is active, no client has pointer focus
        handle.motion(data, None, event);

        // Minimized, closed, or sent to another Space while held: the drag is over.
        if !data.holds_on_screen(&self.window) {
            data.drag_cancelled();
            handle.unset_grab(self, data, event.serial, event.time, true);
            return;
        }
        if !self.moving {
            if !past_slop(self.start_data.location, event.location) {
                return;
            }
            self.moving = true;
            data.report_grab(&self.window, "move", self.start_data.location);
        }
        // The shell framed it meanwhile (its own size back, placed for the
        // pointer at the press): held from that frame on.
        if std::mem::take(&mut data.held_reframed)
            && let Some(location) = data.space.element_location(&self.window)
        {
            self.initial_window_location = location;
        }
        let delta = event.location - self.start_data.location;
        let new_location = self.initial_window_location.to_f64() + delta;
        data.space
            .map_element(self.window.clone(), new_location.to_i32_round(), true);
        data.drag_moved(event.location);
        data.edge_watch(event.location);
    }

    fn relative_motion(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        focus: Option<(WlSurface, Point<f64, Logical>)>,
        event: &RelativeMotionEvent,
    ) {
        // Pushing on out through the edge it rests against is not resting (zones.rs).
        if data
            .edge_hold
            .edge()
            .is_some_and(|edge| edge.outward(event.delta))
        {
            data.drag_pushed();
        }
        handle.relative_motion(data, focus, event);
    }

    fn button(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &ButtonEvent,
    ) {
        handle.button(data, event);

        // The button is a button code as defined in the
        // Linux kernel's linux/input-event-codes.h header file, e.g. BTN_LEFT.
        const BTN_LEFT: u32 = 0x110;

        if !handle.current_pressed().contains(&BTN_LEFT) {
            // No more buttons are pressed, release the grab.
            if self.moving {
                data.drag_released(&self.window);
            } else {
                data.drag_cancelled();
            }
            handle.unset_grab(self, data, event.serial, event.time, true);
        }
    }

    fn axis(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        details: AxisFrame,
    ) {
        handle.axis(data, details)
    }

    fn frame(&mut self, data: &mut Dashi, handle: &mut PointerInnerHandle<'_, Dashi>) {
        handle.frame(data);
    }

    fn gesture_swipe_begin(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GestureSwipeBeginEvent,
    ) {
        handle.gesture_swipe_begin(data, event)
    }

    fn gesture_swipe_update(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GestureSwipeUpdateEvent,
    ) {
        handle.gesture_swipe_update(data, event)
    }

    fn gesture_swipe_end(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GestureSwipeEndEvent,
    ) {
        handle.gesture_swipe_end(data, event)
    }

    fn gesture_pinch_begin(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GesturePinchBeginEvent,
    ) {
        handle.gesture_pinch_begin(data, event)
    }

    fn gesture_pinch_update(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GesturePinchUpdateEvent,
    ) {
        handle.gesture_pinch_update(data, event)
    }

    fn gesture_pinch_end(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GesturePinchEndEvent,
    ) {
        handle.gesture_pinch_end(data, event)
    }

    fn gesture_hold_begin(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GestureHoldBeginEvent,
    ) {
        handle.gesture_hold_begin(data, event)
    }

    fn gesture_hold_end(
        &mut self,
        data: &mut Dashi,
        handle: &mut PointerInnerHandle<'_, Dashi>,
        event: &GestureHoldEndEvent,
    ) {
        handle.gesture_hold_end(data, event)
    }

    fn start_data(&self) -> &PointerGrabStartData<Dashi> {
        &self.start_data
    }

    fn unset(&mut self, data: &mut Dashi) {
        data.held = None;
        data.held_reframed = false;
        data.edge_hold.end();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drag_starts_past_the_slop() {
        let press = Point::from((100.0, 50.0));
        assert!(!past_slop(press, Point::from((100.0, 50.0))));
        assert!(!past_slop(press, Point::from((102.0, 52.0))));
        assert!(past_slop(press, Point::from((104.0, 50.0))));
        assert!(past_slop(press, Point::from((97.0, 47.0))));
    }
}
