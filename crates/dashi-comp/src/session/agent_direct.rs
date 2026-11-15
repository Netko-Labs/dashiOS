//! An agent's input into a window on the Space that shows, without the
//! person's seat (decisions.md D110). Apps that hear one seat (`borrow`)
//! used to get the person's pointer and keyboard for each action, once the
//! person had paused: their pointer jumped and their focus moved. A Wayland
//! window is told instead as one off screen is (agent_away.rs): the events
//! go straight to its app, on the wl_pointer and wl_keyboard it made on the
//! person's seat, and the seat is left alone. The window is neither raised
//! nor given the keyboard; the agent's pointer is drawn where it acts. It is
//! refused while the person's own press in that window is under `idleMs` old.
//!
//! What still borrows the seat, because only the seat can do it:
//!  - an X11 window (Xwayland has one pointer and one focus);
//!  - a press held and its release (a drag: the app asks the compositor to
//!    move or resize its window with the seat's press, and drags data);
//!  - a click on one of the window's lights (dashi-comp's own, on the seat's path);
//!  - keys that copy, cut or paste (selections follow the seat's real focus).

use smithay::{desktop::Window, utils::Point};

use super::agent_input::{AgentInput, KeyMove, KeyStep, PointerAction};
use crate::{session::origin::Target, state::Dashi, wm::WindowId};

impl Dashi {
    /// Whether this request into `window`, on screen, goes straight to its app.
    pub(super) fn agent_goes_direct(
        &self,
        id: WindowId,
        window: &Window,
        params: &AgentInput,
    ) -> bool {
        // `idleMs: 0` asks for the seat itself, at once: the person is known to be away.
        let waits = params
            .borrow
            .is_some_and(|borrow| borrow.idle_ms.is_none_or(|ms| ms.to::<u64>() > 0));
        if !waits
            || window.x11_surface().is_some()
            || !self.agent.pressed_buttons.is_empty()
            || !self.agent.pressed_keys.is_empty()
            || !needs_no_seat(params)
        {
            return false;
        }
        let on_light = || {
            let at = params.pointer?;
            let content = self.space.element_geometry(window)?;
            let global = content.loc.to_f64() + Point::from((at.x.get(), at.y.get()));
            self.light_of(id, window, global)
        };
        params.action != Some(PointerAction::Click) || on_light().is_none()
    }

    /// Carry it out: as off screen, with the agent's pointer drawn and the press marked as its own.
    pub(super) fn agent_input_direct(
        &mut self,
        id: WindowId,
        window: &Window,
        params: &AgentInput,
    ) -> Result<(), String> {
        let content = self
            .space
            .element_geometry(window)
            .ok_or("that window is not on screen")?;
        // The person wins in the window they are using: their own press there must be `idleMs` old.
        let idle = params
            .borrow
            .and_then(|borrow| borrow.idle_ms)
            .map_or(super::agent::BORROW_AFTER_MS, |ms| ms.to::<u64>())
            .min(60_000);
        let theirs = self
            .origins
            .describe(&Target::Window(id), std::time::Instant::now())
            .person;
        if let Some(ago) = theirs.filter(|ago| *ago < idle) {
            return Err(format!(
                "the person is using the desktop (free in {} ms)",
                idle - ago
            ));
        }
        self.agent_input_away(id, window, content, params)?;
        if let Some(pointer) = self.agent.away.pointer.as_mut() {
            pointer.shown = true;
        }
        if let Some(at) = params.pointer {
            let global = content.loc.to_f64() + Point::from((at.x.get(), at.y.get()));
            let label = params.label.as_deref().unwrap_or("Agent");
            self.agent.pointer = Some((global, label.chars().take(40).collect()));
        }
        if params.keys.is_some() || params.action == Some(PointerAction::Click) {
            self.note_agent_press(id);
        }
        Ok(())
    }
}

/// Whether the request is one an app can be told without the seat: a move, a
/// click or a scroll, and keys that are not the clipboard's.
fn needs_no_seat(params: &AgentInput) -> bool {
    let pointer = params.pointer.is_none()
        || matches!(
            params.action.unwrap_or_default(),
            PointerAction::Move | PointerAction::Click | PointerAction::Scroll
        );
    pointer && !params.keys.as_deref().is_some_and(uses_clipboard)
}

/// Whether `steps` copy, cut or paste: C, X, V or Insert with Control or Super held.
fn uses_clipboard(steps: &[KeyStep]) -> bool {
    let mut held = 0;
    for step in steps {
        let Some(name) = step.name.as_deref() else {
            continue;
        };
        if matches!(
            name,
            "Control_L" | "Control_R" | "Super_L" | "Super_R" | "Shift_L" | "Shift_R"
        ) {
            match step.state {
                Some(KeyMove::Down) => held += 1,
                Some(KeyMove::Up) => held -= 1,
                None => {}
            }
        } else if held > 0 && matches!(name, "c" | "x" | "v" | "C" | "X" | "V" | "Insert") {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(json: serde_json::Value) -> AgentInput {
        serde_json::from_value(json).expect("an agent-input request")
    }

    #[test]
    fn clicks_scrolls_and_typing_need_no_seat() {
        for ok in [
            serde_json::json!({ "pointer": { "x": 1, "y": 1 }, "action": "click" }),
            serde_json::json!({ "pointer": { "x": 1, "y": 1 } }),
            serde_json::json!({ "pointer": { "x": 1, "y": 1 }, "action": "scroll", "scroll": { "dy": 40 } }),
            serde_json::json!({ "keys": [{ "text": "Hello" }, { "name": "Return" }] }),
            serde_json::json!({ "keys": [{ "name": "Control_L", "state": "down" }, { "name": "s" }, { "name": "Control_L", "state": "up" }] }),
        ] {
            assert!(needs_no_seat(&request(ok.clone())), "{ok}");
        }
    }

    #[test]
    fn drags_and_the_clipboard_need_the_seat() {
        for seat in [
            serde_json::json!({ "pointer": { "x": 1, "y": 1 }, "action": "press" }),
            serde_json::json!({ "pointer": { "x": 1, "y": 1 }, "action": "release" }),
            serde_json::json!({ "keys": [{ "name": "Control_L", "state": "down" }, { "name": "v" }, { "name": "Control_L", "state": "up" }] }),
            serde_json::json!({ "keys": [{ "name": "Shift_L", "state": "down" }, { "name": "Insert" }, { "name": "Shift_L", "state": "up" }] }),
        ] {
            assert!(!needs_no_seat(&request(seat.clone())), "{seat}");
        }
    }
}
