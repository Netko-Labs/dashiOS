//! The pointer moving and scrolling: to the client under it, past whatever
//! holds it (a lock or a confinement), and to the compositor's own hovers.

use smithay::{
    backend::input::{
        AbsolutePositionEvent, Axis, AxisSource, Event, InputBackend, PointerAxisEvent,
        PointerMotionEvent,
    },
    input::pointer::{AxisFrame, MotionEvent, RelativeMotionEvent},
    utils::SERIAL_COUNTER,
};

use crate::state::Dashi;

impl Dashi {
    /// A relative motion (a mouse, a touchpad).
    pub(super) fn on_pointer_motion<I: InputBackend>(&mut self, event: &I::PointerMotionEvent) {
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

    /// An absolute motion (a tablet, the nested window's pointer): on the first screen.
    pub(super) fn on_pointer_motion_absolute<I: InputBackend>(
        &mut self,
        event: &I::PointerMotionAbsoluteEvent,
    ) {
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

        // A locked pointer stays where it is; a tablet has no relative motion to give.
        if self.pointer_locked() {
            return;
        }
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

    /// A scroll, at the person's speed for the device.
    pub(super) fn on_pointer_axis<I: InputBackend>(&mut self, event: &I::PointerAxisEvent) {
        let source = event.source();
        // The person's scroll speed for this kind of device (input/settings.rs).
        let factor = self.scroll_factor(source);

        let horizontal_amount = factor
            * event.amount(Axis::Horizontal).unwrap_or_else(|| {
                event.amount_v120(Axis::Horizontal).unwrap_or(0.0) * 15.0 / 120.
            });
        let vertical_amount = factor
            * event
                .amount(Axis::Vertical)
                .unwrap_or_else(|| event.amount_v120(Axis::Vertical).unwrap_or(0.0) * 15.0 / 120.);
        let horizontal_amount_discrete = event.amount_v120(Axis::Horizontal).map(|v| v * factor);
        let vertical_amount_discrete = event.amount_v120(Axis::Vertical).map(|v| v * factor);

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
}
