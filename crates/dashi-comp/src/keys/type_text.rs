//! `type-text`: words typed into the window that has the keyboard, whatever
//! the layout (dictation; docs/compositor-ipc.md, "Keys"). The layout may
//! have no key for ñ or é, so for a moment the keyboard is given a keymap made
//! for the text, one key for each character in it; the keys are pressed, and
//! the person's layout is put back. The client reads all three in order, as
//! it would a change of layout. Nothing touches the clipboard.
//!
//! Two things ride with the text, because only this way do they reach the
//! window in order (a `send-keys` chord goes through the person's input
//! method and arrives after keys typed here): `erase`, that many BackSpaces
//! before the text, for what the shell itself typed and takes back
//! (dictation's Undo; the shell checks the field first); and `breaks`, the
//! chord a line break is typed as where Return would send ("shift+Return",
//! "ctrl+j").
//!
//! Refused, with nothing typed: while locked; when `window` no longer has
//! the keyboard (`left-window`); for an X11 window, whose keymap changes too
//! slowly to trust (`x11`); while the person holds a key down (`keys-down`:
//! its release would land in the wrong keymap); text with nothing to type.

use serde::{Deserialize, Serialize};
use smithay::{input::keyboard::Keycode, wayland::input_method::InputMethodSeat};

use super::type_plan::{Press, keymap_for, plan, runs};
use crate::{ipc::protocol::WindowId, session::agent_keys::key_route, state::Dashi};

/// At most this many characters at once.
const MAX_TEXT: usize = 8192;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TypeText {
    pub window: WindowId,
    pub text: String,
    /// BackSpace this many times before the text.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub erase: u32,
    /// The chord a line break is typed as, in place of Return ("shift+Return").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breaks: Option<String>,
}

fn is_zero(count: &u32) -> bool {
    *count == 0
}

/// At most this many BackSpaces at once.
const MAX_ERASE: u32 = 8192;

impl Dashi {
    /// `type-text {window, text}`.
    pub(crate) fn type_text(&mut self, params: &TypeText) -> Result<(), String> {
        if self.lock.locked {
            return Err("the screen is locked".into());
        }
        if params.text.chars().count() > MAX_TEXT || params.erase > MAX_ERASE {
            return Err("too much text at once".into());
        }
        let id = params.window.0;
        if self.focused_window_id() != Some(id) {
            return Err("left-window".into());
        }
        let x11 = self
            .windows
            .get(id)
            .is_some_and(|entry| entry.window.x11_surface().is_some());
        if x11 {
            return Err("x11".into());
        }
        let keyboard = self.seat.get_keyboard().ok_or("the seat has no keyboard")?;
        let surface = keyboard.current_focus().ok_or("left-window")?;
        if !keyboard.pressed_keys().is_empty() {
            return Err("keys-down".into());
        }
        let groups = plan(params)?;
        if groups.is_empty() {
            return Err("nothing to type".into());
        }
        let time = u32::try_from(self.start_time.elapsed().as_millis()).unwrap_or(u32::MAX);
        let route = key_route(self.seat.input_method().keyboard_grabbed());
        let mut result = Ok(());
        for run in runs(&groups) {
            if keyboard
                .set_keymap_from_string(self, keymap_for(&run.symbols))
                .is_err()
            {
                result = Err("the keymap for this text does not compile".to_owned());
                break;
            }
            for (code, press) in run.keys {
                let code = Keycode::new(code);
                if press != Press::Up {
                    self.agent_key(&keyboard, &surface, route, code, true, time);
                }
                if press != Press::Down {
                    self.agent_key(&keyboard, &surface, route, code, false, time);
                }
            }
        }
        // The person's layout again, whatever happened.
        self.restore_layout();
        self.keys.snippets.reset();
        result
    }
}
