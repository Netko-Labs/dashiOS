//! An agent's input into a window on a Space that does not show
//! (`agent-input`, session/agent.rs). The window is off screen, so nothing of
//! the person's may move for it: not their pointer, not their keyboard
//! focus, not their modifiers. The seat's own state (smithay's pointer and
//! keyboard) is therefore left alone, and the events go straight to the
//! window's client, on the wl_pointer and wl_keyboard it made on the
//! person's seat (the one seat single-seat toolkits hear):
//!
//!  - The pointer enters the surface, acts, and stays in it until the agent
//!    lets go, acts elsewhere, or a Space switch brings the window on screen.
//!  - The keyboard enters, the keys go with modifiers kept in an xkb state of
//!    the agent's own (the person's Shift is not the agent's), and it leaves:
//!    one request, whole. A key left down is let go at the request's end.
//!  - When the client also has the person's pointer or keyboard (another
//!    window of the same app, on the Space that shows), a wl_pointer or
//!    wl_keyboard can only be in one of its surfaces: the person's leaves
//!    for the length of the request and is given back at its end, and only
//!    once their own input is `ASIDE_AFTER` old (else the usual refusal,
//!    which the shell waits out).
//!
//! What this cannot do: the clipboard (selections follow the seat's real
//! focus), X11 windows (Xwayland has one focus), and a window's lights.

use std::time::{Duration, Instant};

use smithay::{
    backend::input::ButtonState,
    desktop::{Window, WindowSurfaceType},
    reexports::wayland_server::{
        Client, Resource,
        protocol::{
            wl_pointer::{self, WlPointer},
            wl_surface::WlSurface,
        },
    },
    utils::{Logical, Point, Rectangle, SERIAL_COUNTER},
};

pub(crate) use super::agent_away_state::Away;
use super::{
    agent_away_state::AwayPointer,
    agent_input::{AgentInput, PointerAction},
    agent_pointer::button_code,
};
use crate::{
    ipc::protocol::Finite,
    state::Dashi,
    wm::{Shown, WindowId},
};

/// How old the person's own input must be before their pointer or keyboard
/// steps aside in a client the agent acts in on another Space.
const ASIDE_AFTER: Duration = Duration::from_millis(400);
/// Where a window waits on its Space: its content (as `Space::element_geometry` has it on screen).
pub(crate) fn away_content(
    state: &Dashi,
    id: WindowId,
) -> Option<(Window, Rectangle<i32, Logical>)> {
    let entry = state.windows.get(id)?;
    if !entry.placed || entry.shown != Shown::Normal || entry.space == state.spaces.current {
        return None;
    }
    let at = entry.away_at?;
    Some((
        entry.window.clone(),
        Rectangle::new(at, entry.window.geometry().size),
    ))
}

fn pointer_frame(pointer: &WlPointer) {
    if pointer.version() >= 5 {
        pointer.frame();
    }
}

impl Dashi {
    /// `agent-input` into window `id`, which waits at `content` on a Space that does not show.
    pub(super) fn agent_input_away(
        &mut self,
        id: WindowId,
        window: &Window,
        content: Rectangle<i32, Logical>,
        params: &AgentInput,
    ) -> Result<(), String> {
        if window.x11_surface().is_some() {
            return Err(
                "an X11 app's window hears the agent only on the Space that shows; \
                 move it there, or switch to its Space"
                    .into(),
            );
        }
        let surface = crate::wm::toplevel_surface(window).ok_or("that window has no surface")?;
        let client = surface.client().ok_or("that window's app is gone")?;
        // The agent's pointer is not drawn: it is on a Space the person is not looking at.
        self.agent.pointer = None;
        if let Some(at) = params.pointer {
            let (x, y) = (at.x.get(), at.y.get());
            if x < 0.0 || y < 0.0 || x > f64::from(content.size.w) || y > f64::from(content.size.h)
            {
                return Err("the point is outside the window".into());
            }
            // In the window's own coordinates, as its surfaces are laid out.
            let inside = Point::from((x, y)) + window.geometry().loc.to_f64();
            let (under, origin) = window
                .surface_under(inside, WindowSurfaceType::ALL)
                .ok_or("nothing of the window is at that point")?;
            let local = inside - origin.to_f64();
            self.away_pointer(&client, under, local, params)?;
        }
        if let Some(keys) = &params.keys {
            self.away_keys(&client, &surface, keys)?;
        }
        self.agent.away.wake(id, Instant::now());
        Ok(())
    }

    /// Whether the person's own input is old enough for their pointer or keyboard to step aside.
    pub(super) fn may_step_aside(&self) -> Result<(), String> {
        self.activity()
            .may_borrow(Instant::now(), ASIDE_AFTER)
            .map_err(|wait| {
                format!(
                    "the person is using the desktop (free in {} ms)",
                    wait.as_millis()
                )
            })
    }

    /// Move the agent's pointer to `local` in `surface`, and carry out the request's action there.
    fn away_pointer(
        &mut self,
        client: &Client,
        surface: WlSurface,
        local: Point<f64, Logical>,
        params: &AgentInput,
    ) -> Result<(), String> {
        let person = self.seat.get_pointer().ok_or("the seat has no pointer")?;
        let pointers: Vec<WlPointer> = person.client_pointers(client).collect();
        let time = self.start_time.elapsed().as_millis() as u32;
        let entered = self
            .agent
            .away
            .pointer
            .as_ref()
            .is_some_and(|pointer| pointer.surface == surface);
        if !entered {
            self.away_pointer_leave();
            // The person's pointer, in another window of this app, leaves it first (and stays where it is).
            let theirs = person
                .current_focus()
                .is_some_and(|focus| focus.client().as_ref() == Some(client));
            if theirs {
                self.may_step_aside()?;
                let event = smithay::input::pointer::MotionEvent {
                    location: person.current_location(),
                    serial: SERIAL_COUNTER.next_serial(),
                    time,
                };
                person.motion(self, None, &event);
                person.frame(self);
            }
            let serial = SERIAL_COUNTER.next_serial().into();
            for pointer in &pointers {
                pointer.enter(serial, &surface, local.x, local.y);
                pointer_frame(pointer);
            }
            self.agent.away.pointer = Some(AwayPointer {
                surface,
                buttons: Vec::new(),
                aside: theirs,
            });
        }
        let button = button_code(params.button);
        let press = |down: bool| {
            let serial = SERIAL_COUNTER.next_serial().into();
            let state = if down {
                ButtonState::Pressed
            } else {
                ButtonState::Released
            };
            for pointer in &pointers {
                pointer.button(serial, time, button, state.into());
                pointer_frame(pointer);
            }
        };
        for pointer in &pointers {
            pointer.motion(time, local.x, local.y);
            pointer_frame(pointer);
        }
        let held = self.agent.away.pointer.as_mut().map(|p| &mut p.buttons);
        match params.action.unwrap_or_default() {
            PointerAction::Move => {}
            PointerAction::Click => {
                press(true);
                press(false);
            }
            PointerAction::Press => {
                press(true);
                if let Some(held) = held {
                    held.push(button);
                }
            }
            PointerAction::Release => {
                press(false);
                if let Some(held) = held {
                    held.retain(|b| *b != button);
                }
            }
            PointerAction::Scroll => {
                let scroll = params.scroll.ok_or("scroll needs `scroll {dx, dy}`")?;
                let amount = |value: Option<Finite>| {
                    value.map_or(0.0, Finite::get).clamp(-10_000.0, 10_000.0)
                };
                for pointer in &pointers {
                    away_scroll(pointer, time, amount(scroll.dx), amount(scroll.dy));
                }
            }
        }
        // The person's pointer comes back to its window as soon as nothing is held.
        let done = self
            .agent
            .away
            .pointer
            .as_ref()
            .is_some_and(|pointer| pointer.aside && pointer.buttons.is_empty());
        if done {
            self.away_pointer_leave();
        }
        Ok(())
    }

    /// The agent's pointer leaves the off-screen window it is in, letting go of what it holds.
    /// The person's pointer, if it stood aside, enters what is under it again (input/follow.rs).
    pub(crate) fn away_pointer_leave(&mut self) {
        let Some(away) = self.agent.away.pointer.take() else {
            return;
        };
        let (Some(person), Some(client)) = (self.seat.get_pointer(), away.surface.client()) else {
            return;
        };
        // Its surface is gone (the window closed under it): there is nothing to leave.
        if !away.surface.is_alive() {
            return;
        }
        let time = self.start_time.elapsed().as_millis() as u32;
        for pointer in person.client_pointers(&client) {
            for button in &away.buttons {
                let serial = SERIAL_COUNTER.next_serial().into();
                pointer.button(serial, time, *button, wl_pointer::ButtonState::Released);
                pointer_frame(&pointer);
            }
            pointer.leave(SERIAL_COUNTER.next_serial().into(), &away.surface);
            pointer_frame(&pointer);
        }
    }

    /// The off-screen windows an agent works in: they hear frames, so they draw what it did.
    pub(crate) fn agent_awake_off_screen(&self) -> Vec<Window> {
        self.agent
            .away
            .awake(Instant::now())
            .filter_map(|id| self.windows.get(id))
            .filter(|entry| self.space.element_location(&entry.window).is_none())
            .map(|entry| entry.window.clone())
            .collect()
    }
}

/// A scroll of so many pixels from a continuous source (as agent_pointer.rs sends on screen).
fn away_scroll(pointer: &WlPointer, time: u32, dx: f64, dy: f64) {
    if pointer.version() >= 5 {
        pointer.axis_source(wl_pointer::AxisSource::Continuous);
    }
    for (axis, amount) in [
        (wl_pointer::Axis::HorizontalScroll, dx),
        (wl_pointer::Axis::VerticalScroll, dy),
    ] {
        if amount != 0.0 {
            pointer.axis(time, axis, amount);
        }
    }
    pointer_frame(pointer);
}
