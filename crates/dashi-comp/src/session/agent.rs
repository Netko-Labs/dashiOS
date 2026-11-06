//! An agent's hands (`agent-input`): with `DASHI_AGENT_SEAT=1`, a second seat,
//! "agent", whose pointer and keyboard reach only the window the shell named,
//! so the agent never takes the person's focus or pointer. It is opt-in: a
//! toolkit that reads one seat (GPUI, so the shell itself, and others)
//! follows the last seat announced and would stop hearing the person's
//! keyboard. Without it, and for apps that read one seat only (and X11
//! apps, `borrow {idleMs}`), an action borrows the person's seat, allowed
//! only once the person has left it alone that long. The agent's pointer is
//! drawn with its name. Consent and policy are the shell's
//! (packages/shell/src/agents/); this carries the input out.

use std::time::Duration;

use serde_json::{Map, Value};
use smithay::{
    backend::input::{Axis, AxisSource, ButtonState, KeyState},
    desktop::WindowSurfaceType,
    input::{
        Seat,
        keyboard::{FilterResult, Keycode, xkb},
        pointer::{AxisFrame, ButtonEvent, MotionEvent},
    },
    reexports::wayland_server::protocol::wl_surface::WlSurface,
    utils::{Logical, Point, SERIAL_COUNTER},
};

use crate::state::Dashi;

const BTN_LEFT: u32 = 0x110;
const BTN_RIGHT: u32 = 0x111;
const BTN_MIDDLE: u32 = 0x112;
/// The longest text typed in one request.
const MAX_TEXT: usize = 4096;

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

/// How long the person must have left the desktop alone before an action
/// borrows their seat, when the shell does not say.
const BORROW_AFTER_MS: u64 = 3000;

pub(crate) struct Agent {
    /// The agent's own seat, when it has one (`DASHI_AGENT_SEAT=1`).
    pub seat: Option<Seat<Dashi>>,
    /// Where the agent's pointer is (global logical) and whose it is; None while hidden.
    pub pointer: Option<(Point<f64, Logical>, String)>,
    pressed_buttons: Vec<u32>,
    pressed_keys: Vec<Keycode>,
}

impl Agent {
    pub(crate) fn new(seat: Option<Seat<Dashi>>) -> Self {
        Self {
            seat,
            pointer: None,
            pressed_buttons: Vec::new(),
            pressed_keys: Vec::new(),
        }
    }
}

fn button_code(name: Option<&str>) -> Result<u32, String> {
    match name.unwrap_or("left") {
        "left" => Ok(BTN_LEFT),
        "right" => Ok(BTN_RIGHT),
        "middle" => Ok(BTN_MIDDLE),
        other => Err(format!("unknown button {other:?}")),
    }
}

impl Dashi {
    /// `agent-input {window, label, pointer?, action?, button?, scroll?, keys?, borrow?}` or `{release}`.
    pub(crate) fn agent_input(&mut self, params: &Map<String, Value>) -> Result<(), String> {
        if params.get("release") == Some(&Value::Bool(true)) {
            self.agent_release();
            return Ok(());
        }
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        let id = params
            .get("window")
            .and_then(Value::as_u64)
            .ok_or("`window` must be a window id")?;
        let entry = self
            .windows
            .get(id)
            .filter(|e| e.announced)
            .ok_or_else(|| format!("no window {id}"))?;
        let window = entry.window.clone();
        let content = self
            .space
            .element_geometry(&window)
            .ok_or("that window is not on screen")?;
        let label = params
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or("Agent")
            .chars()
            .take(40)
            .collect::<String>();

        // The person's seat, borrowed, only when they have left it alone long enough.
        let seat = match (params.get("borrow"), &self.agent.seat) {
            (None, Some(agent)) => agent.clone(),
            (borrow, _) => {
                let idle = borrow
                    .and_then(|borrow| borrow.get("idleMs"))
                    .and_then(Value::as_u64)
                    .unwrap_or(BORROW_AFTER_MS)
                    .min(60_000);
                if self.idle_for() < Duration::from_millis(idle) {
                    return Err("the person is using the desktop".into());
                }
                self.seat.clone()
            }
        };

        if let Some(at) = params.get("pointer") {
            let x = at
                .get("x")
                .and_then(Value::as_f64)
                .ok_or("`pointer` needs x and y")?;
            let y = at
                .get("y")
                .and_then(Value::as_f64)
                .ok_or("`pointer` needs x and y")?;
            if x < 0.0 || y < 0.0 || x > f64::from(content.size.w) || y > f64::from(content.size.h)
            {
                return Err("the point is outside the window".into());
            }
            let global = content.loc.to_f64() + Point::from((x, y));
            let render_at = content.loc - window.geometry().loc;
            let under = window
                .surface_under(global - render_at.to_f64(), WindowSurfaceType::ALL)
                .map(|(surface, loc)| (surface, (loc + render_at).to_f64()));
            self.agent.pointer = Some((global, label.clone()));
            let action = params
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("move");
            self.agent_pointer(&seat, global, under, action, params)?;
            if matches!(action, "click" | "press") {
                self.note_agent_press(id);
            }
        }

        if let Some(keys) = params.get("keys") {
            let keys = keys.as_array().ok_or("`keys` must be a list")?;
            let Some(surface) = crate::wm::toplevel_surface(&window) else {
                return Ok(());
            };
            self.agent_keys(&seat, surface, keys)?;
            self.note_agent_press(id);
        }
        Ok(())
    }

    /// An agent's press, even on the person's borrowed seat, is marked as the agent's.
    fn note_agent_press(&mut self, window: u64) {
        let target = crate::session::origin::Target::Window(window);
        self.origins.agent(target, std::time::Instant::now());
    }

    fn agent_pointer(
        &mut self,
        seat: &Seat<Dashi>,
        at: Point<f64, Logical>,
        under: Option<(WlSurface, Point<f64, Logical>)>,
        action: &str,
        params: &Map<String, Value>,
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
        let button = button_code(params.get("button").and_then(Value::as_str))?;
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
            "move" => {}
            "click" => {
                press(self, true);
                press(self, false);
            }
            "press" => {
                press(self, true);
                self.agent.pressed_buttons.push(button);
            }
            "release" => {
                press(self, false);
                self.agent.pressed_buttons.retain(|b| *b != button);
            }
            "scroll" => {
                let scroll = params
                    .get("scroll")
                    .ok_or("scroll needs `scroll {dx, dy}`")?;
                let dx = scroll
                    .get("dx")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .clamp(-10_000.0, 10_000.0);
                let dy = scroll
                    .get("dy")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .clamp(-10_000.0, 10_000.0);
                pointer.axis(self, wheel_frame(time, dx, dy));
                pointer.frame(self);
            }
            other => return Err(format!("unknown action {other:?}")),
        }
        Ok(())
    }

    fn agent_keys(
        &mut self,
        seat: &Seat<Dashi>,
        surface: WlSurface,
        steps: &[Value],
    ) -> Result<(), String> {
        let Some(keyboard) = seat.get_keyboard() else {
            return Err("the seat has no keyboard".into());
        };
        if keyboard.current_focus().as_ref() != Some(&surface) {
            if seat == &self.seat {
                // The person's seat, borrowed: its keyboard follows the lock's rule (session/lock.rs).
                self.set_keyboard_focus(Some(surface), SERIAL_COUNTER.next_serial());
            } else {
                keyboard.set_focus(self, Some(surface), SERIAL_COUNTER.next_serial());
            }
        }
        let time = self.start_time.elapsed().as_millis() as u32;
        let send = |state: &mut Dashi, code: Keycode, down: bool| {
            let key_state = if down {
                KeyState::Pressed
            } else {
                KeyState::Released
            };
            keyboard.input::<(), _>(
                state,
                code,
                key_state,
                SERIAL_COUNTER.next_serial(),
                time,
                |_, _, _| FilterResult::Forward,
            );
        };
        for step in steps {
            if let Some(text) = step.get("text").and_then(Value::as_str) {
                if text.chars().count() > MAX_TEXT {
                    return Err("too much text at once".into());
                }
                for ch in text.chars() {
                    let name = xkb::keysym_get_name(xkb::utf32_to_keysym(ch as u32));
                    let Some((code, shift)) = self.keycode_named(&name) else {
                        continue;
                    };
                    let shift_code = shift
                        .then(|| self.keycode_named("Shift_L"))
                        .flatten()
                        .map(|(c, _)| c);
                    if let Some(shift) = shift_code {
                        send(self, shift, true);
                    }
                    send(self, code, true);
                    send(self, code, false);
                    if let Some(shift) = shift_code {
                        send(self, shift, false);
                    }
                }
                continue;
            }
            let name = step
                .get("name")
                .and_then(Value::as_str)
                .ok_or("a key step needs text or a name")?;
            let (code, _) = self
                .keycode_named(name)
                .ok_or_else(|| format!("no key {name:?} on this keyboard"))?;
            match step.get("state").and_then(Value::as_str) {
                Some("down") => {
                    send(self, code, true);
                    self.agent.pressed_keys.push(code);
                }
                Some("up") => {
                    send(self, code, false);
                    self.agent.pressed_keys.retain(|c| *c != code);
                }
                None => {
                    send(self, code, true);
                    send(self, code, false);
                }
                Some(other) => return Err(format!("unknown key state {other:?}")),
            }
        }
        Ok(())
    }

    /// Let go of everything the agent holds and hide its pointer.
    pub(crate) fn agent_release(&mut self) {
        let time = self.start_time.elapsed().as_millis() as u32;
        let seat = self.agent.seat.clone();
        if let Some(pointer) = seat.as_ref().and_then(Seat::get_pointer) {
            for button in std::mem::take(&mut self.agent.pressed_buttons) {
                let event = ButtonEvent {
                    serial: SERIAL_COUNTER.next_serial(),
                    time,
                    button,
                    state: ButtonState::Released,
                };
                pointer.button(self, &event);
            }
            pointer.frame(self);
        }
        if let Some(keyboard) = seat.as_ref().and_then(Seat::get_keyboard) {
            for code in std::mem::take(&mut self.agent.pressed_keys) {
                keyboard.input::<(), _>(
                    self,
                    code,
                    KeyState::Released,
                    SERIAL_COUNTER.next_serial(),
                    time,
                    |_, _, _| FilterResult::Forward,
                );
            }
        }
        self.agent.pointer = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_by_name() {
        assert_eq!(button_code(None), Ok(BTN_LEFT));
        assert_eq!(button_code(Some("right")), Ok(BTN_RIGHT));
        assert!(button_code(Some("thumb")).is_err());
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
