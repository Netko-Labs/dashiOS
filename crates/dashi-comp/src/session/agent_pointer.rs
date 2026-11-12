//! An agent's pointer (`agent-input` pointer actions, session/agent.rs): its
//! motion, its buttons, and its scroll as a mouse wheel's.

use smithay::{
    backend::input::{Axis, AxisSource, ButtonState},
    input::{
        Seat,
        pointer::{AxisFrame, ButtonEvent, MotionEvent},
    },
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point, SERIAL_COUNTER},
};

use super::agent_input::{AgentInput, Button, PointerAction};
use crate::{ipc::protocol::Finite, state::Dashi};

const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;

/// A wheel notch, in pixels: what libinput's 120 steps scroll (input/mod.rs).
const WHEEL_NOTCH_PX: f64 = 15.0;

/// An agent's scroll as a mouse wheel's: the pixels and their 120ths of a
/// notch, on the axes that move. A wheel's frame needs both: GPUI, among
/// others, reads only the steps of a wheel and drops its bare pixels.
fn wheel_frame(time: u32, dx: f64, dy: f64) -> AxisFrame {
    let mut frame = AxisFrame::new(time).source(AxisSource::Wheel);
    for (axis, amount) in [(Axis::Horizontal, dx), (Axis::Vertical, dy)] {
        if amount != 0.0 {
            let steps = (amount * 120.0 / WHEEL_NOTCH_PX).round() as i32;
            frame = frame.value(axis, amount).v120(axis, steps);
        }
    }
    frame
}

pub(super) fn button_code(button: Option<Button>) -> u32 {
    match button.unwrap_or_default() {
        Button::Left => BTN_LEFT,
        Button::Right => BTN_RIGHT,
        Button::Middle => BTN_MIDDLE,
    }
}

impl Dashi {
    /// Move the agent's pointer to `at` on `seat`, over `under`, and carry out `action` there.
    pub(super) fn agent_pointer(
        &mut self,
        seat: &Seat<Dashi>,
        at: Point<f64, Logical>,
        under: Option<(WlSurface, Point<f64, Logical>)>,
        action: PointerAction,
        params: &AgentInput,
    ) -> Result<(), String> {
        let Some(pointer) = seat.get_pointer() else {
            return Err("the seat has no pointer".into());
        };
        let time = self.start_time.elapsed().as_millis() as u32;
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
        let button = button_code(params.button);
        let press = |state: &mut Dashi, down: bool| {
            let event = ButtonEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time,
                button,
                state: if down {
                    ButtonState::Pressed
                } else {
                    ButtonState::Released
                },
            };
            pointer.button(state, &event);
            pointer.frame(state);
        };
        match action {
            PointerAction::Move => {}
            PointerAction::Click => {
                press(self, true);
                press(self, false);
            }
            PointerAction::Press => {
                press(self, true);
                self.agent.pressed_buttons.push((seat.clone(), button));
            }
            PointerAction::Release => {
                press(self, false);
                self.agent
                    .pressed_buttons
                    .retain(|(held, b)| !(held == seat && *b == button));
            }
            PointerAction::Scroll => {
                let scroll = params.scroll.ok_or("scroll needs `scroll {dx, dy}`")?;
                let amount = |value: Option<Finite>| {
                    value.map_or(0.0, Finite::get).clamp(-10_000.0, 10_000.0)
                };
                let (dx, dy) = (amount(scroll.dx), amount(scroll.dy));
                pointer.axis(self, wheel_frame(time, dx, dy));
                pointer.frame(self);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_by_name() {
        assert_eq!(button_code(None), BTN_LEFT);
        assert_eq!(button_code(Some(Button::Right)), BTN_RIGHT);
        assert!(serde_json::from_value::<Button>(serde_json::json!("thumb")).is_err());
    }

    #[test]
    fn a_scroll_is_a_wheels_pixels_and_steps() {
        let frame = wheel_frame(7, 0.0, 500.0);
        assert_eq!(frame.source, Some(AxisSource::Wheel));
        assert_eq!(frame.time, 7);
        assert_eq!(frame.axis, (0.0, 500.0));
        // 500 px at 15 a notch: 33⅓ notches.
        assert_eq!(frame.v120, Some((0, 4000)));
        let frame = wheel_frame(0, -15.0, 0.0);
        assert_eq!(frame.axis, (-15.0, 0.0));
        assert_eq!(frame.v120, Some((-120, 0)));
    }
}
