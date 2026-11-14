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

use smithay::{
    backend::input::{ButtonState, KeyState},
    desktop::WindowSurfaceType,
    input::{
        Seat,
        keyboard::{FilterResult, Keycode},
        pointer::ButtonEvent,
    },
    utils::{Logical, Point, SERIAL_COUNTER},
};

use super::agent_input::{AgentInput, PointerAction};
use crate::{render::titlebar::Part, state::Dashi};

/// How long the person must have left the desktop alone before an action
/// borrows their seat, when the shell does not say.
const BORROW_AFTER_MS: u64 = 3000;

pub(crate) struct Agent {
    /// The agent's own seat, when it has one (`DASHI_AGENT_SEAT=1`).
    pub seat: Option<Seat<Dashi>>,
    /// Where the agent's pointer is (global logical) and whose it is; None while hidden.
    pub pointer: Option<(Point<f64, Logical>, String)>,
    /// What the agent holds down, and on which seat: its own, or the person's, borrowed
    /// (a drag in a window that hears only the person's seat).
    pub(super) pressed_buttons: Vec<(Seat<Dashi>, u32)>,
    pub(super) pressed_keys: Vec<(Seat<Dashi>, Keycode)>,
    /// When the agent last acted (`agent-input`): dark screens keep pacing
    /// their clients briskly for a while after (backend/udev/pace.rs).
    pub acted_at: Option<std::time::Instant>,
    /// What it has going in windows on Spaces that do not show (session/agent_away.rs).
    pub away: super::agent_away::Away,
}

impl Agent {
    pub(crate) fn new(seat: Option<Seat<Dashi>>) -> Self {
        Self {
            seat,
            pointer: None,
            pressed_buttons: Vec::new(),
            pressed_keys: Vec::new(),
            acted_at: None,
            away: Default::default(),
        }
    }
}

impl Dashi {
    /// `agent-input {window, label, pointer?, action?, button?, scroll?, keys?, borrow?}` or `{release}`.
    pub(crate) fn agent_input(&mut self, params: &AgentInput) -> Result<(), String> {
        if params.release {
            self.agent_release();
            return Ok(());
        }
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        let id = params
            .window
            .map(|id| id.to::<u64>())
            .ok_or("`window` must be a window id")?;
        let entry = self
            .windows
            .get(id)
            .filter(|e| e.announced)
            .ok_or_else(|| format!("no window {id}"))?;
        let window = entry.window.clone();
        // On a Space that does not show: straight to its client, nothing of the person's moved.
        if let Some((window, content)) = super::agent_away::away_content(self, id) {
            return self.agent_input_away(id, &window, content, params);
        }
        let content = self
            .space
            .element_geometry(&window)
            .ok_or("that window is not on screen")?;
        self.away_pointer_leave();
        let label = params
            .label
            .as_deref()
            .unwrap_or("Agent")
            .chars()
            .take(40)
            .collect::<String>();

        // The person's seat, borrowed, only when they have left it alone long enough.
        let seat = match (params.borrow, &self.agent.seat) {
            (None, Some(agent)) => agent.clone(),
            (borrow, _) => {
                let idle = borrow
                    .and_then(|borrow| borrow.idle_ms)
                    .map_or(BORROW_AFTER_MS, |ms| ms.to::<u64>())
                    .min(60_000);
                // Only the person's own input counts: a page keeping the screen
                // awake (session/idle.rs) and the agent's own actions do not.
                if let Err(wait) = self
                    .activity()
                    .may_borrow(std::time::Instant::now(), Duration::from_millis(idle))
                {
                    return Err(format!(
                        "the person is using the desktop (free in {} ms)",
                        wait.as_millis()
                    ));
                }
                self.seat.clone()
            }
        };

        if let Some(at) = params.pointer {
            let (x, y) = (at.x.get(), at.y.get());
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
            let action = params.action.unwrap_or_default();
            // The lights are dashi-comp's, drawn over the window, and never reach the client: a click
            // there is the light's, as the person's press is (input/decorations.rs), active window or not.
            let light = light_click(action, self.light_of(id, &window, global));
            self.agent_pointer(
                &seat,
                global,
                under,
                if light.is_some() {
                    PointerAction::Move
                } else {
                    action
                },
                params,
            )?;
            if let Some(part) = light {
                self.press_light(id, part)?;
            }
            if matches!(action, PointerAction::Click | PointerAction::Press) {
                self.note_agent_press(id);
            }
        }

        if let Some(keys) = &params.keys {
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

    /// Let go of everything the agent holds, on whichever seat it holds it, and hide its pointer.
    pub(crate) fn agent_release(&mut self) {
        self.away_pointer_leave();
        let time = self.start_time.elapsed().as_millis() as u32;
        for (seat, button) in std::mem::take(&mut self.agent.pressed_buttons) {
            let Some(pointer) = seat.get_pointer() else {
                continue;
            };
            let event = ButtonEvent {
                serial: SERIAL_COUNTER.next_serial(),
                time,
                button,
                state: ButtonState::Released,
            };
            pointer.button(self, &event);
            pointer.frame(self);
        }
        for (seat, code) in std::mem::take(&mut self.agent.pressed_keys) {
            let Some(keyboard) = seat.get_keyboard() else {
                continue;
            };
            keyboard.input::<(), _>(
                self,
                code,
                KeyState::Released,
                SERIAL_COUNTER.next_serial(),
                time,
                |_, _, _| FilterResult::Forward,
            );
        }
        self.agent.pointer = None;
    }

    /// The person is at their seat again (input/events.rs): an agent holding a button or key on
    /// it lets go first, so the person's own input never lands in the middle of an agent's drag.
    pub(crate) fn agent_yields_seat(&mut self) {
        if holds_on(&self.agent, &self.seat) {
            self.agent_release();
        }
        // Their pointer stood aside for the agent, in another window of the same app: it is theirs again.
        if self.agent.away.pointer_aside() {
            self.away_pointer_leave();
        }
    }
}

/// Whether the agent holds a button or key down on `seat`.
fn holds_on(agent: &Agent, seat: &Seat<Dashi>) -> bool {
    agent.pressed_buttons.iter().any(|(held, _)| held == seat)
        || agent.pressed_keys.iter().any(|(held, _)| held == seat)
}

/// The light an agent's `action` presses, when it lands on one (`light`): only a click does, as the
/// lights act on the press and a held press would have nothing to let go.
fn light_click(action: PointerAction, light: Option<Part>) -> Option<Part> {
    light.filter(|_| action == PointerAction::Click)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::titlebar::{Decor, part_at};

    #[test]
    fn a_click_on_a_light_is_the_lights() {
        assert_eq!(
            light_click(PointerAction::Click, Some(Part::Close)),
            Some(Part::Close)
        );
        assert_eq!(light_click(PointerAction::Click, None), None);
        assert_eq!(light_click(PointerAction::Move, Some(Part::Close)), None);
        assert_eq!(light_click(PointerAction::Press, Some(Part::Zoom)), None);
        // Over a unified window's surface, the first light is Close (render/titlebar.rs).
        assert_eq!(part_at(20.0, 19.0, 600, Decor::Unified), Some(Part::Close));
    }
}
