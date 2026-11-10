//! Input going to the program: keys, paste, and the wheel, which also moves
//! the view through the scrollback.

use super::sized_free;
use crate::ffi_generated as ffi;
use crate::keys;
use crate::pty;
use crate::vt::Vt;

impl Vt {
    /// Encode a key for the program running (legacy, or the Kitty protocol if
    /// it asked) and send it. Typing brings the view back to the bottom.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn key(
        &mut self,
        name: &str,
        text: Option<&str>,
        ctrl: bool,
        alt: bool,
        shift: bool,
        meta: bool,
        repeat: bool,
    ) {
        let mut out = [0u8; 128];
        let mut len = 0usize;
        // SAFETY: live encoder, event, and terminal; `text` outlives the encode call.
        let result = unsafe {
            ffi::ghostty_key_encoder_setopt_from_terminal(self.encoder, self.term);
            let action = if repeat {
                ffi::GhosttyKeyAction_GHOSTTY_KEY_ACTION_REPEAT
            } else {
                ffi::GhosttyKeyAction_GHOSTTY_KEY_ACTION_PRESS
            };
            ffi::ghostty_key_event_set_action(self.event, action);
            ffi::ghostty_key_event_set_key(self.event, keys::ghostty_key(name));
            ffi::ghostty_key_event_set_mods(self.event, keys::mods(ctrl, alt, shift, meta));
            ffi::ghostty_key_event_set_consumed_mods(
                self.event,
                if text.is_some() && shift {
                    keys::mods(false, false, true, false)
                } else {
                    0
                },
            );
            let typed = text
                .filter(|t| !t.is_empty() && !t.chars().any(char::is_control))
                .unwrap_or("");
            ffi::ghostty_key_event_set_utf8(self.event, typed.as_ptr().cast(), typed.len());
            ffi::ghostty_key_event_set_unshifted_codepoint(
                self.event,
                keys::unshifted(name).unwrap_or(0),
            );
            ffi::ghostty_key_encoder_encode(
                self.encoder,
                self.event,
                out.as_mut_ptr().cast(),
                out.len(),
                &mut len,
            )
        };
        if result == ffi::GhosttyResult_GHOSTTY_SUCCESS && len > 0 {
            pty::write_all(self.hooks.fd, &out[..len]);
        } else if let Some(text) = text.filter(|t| !t.is_empty()) {
            pty::write_all(self.hooks.fd, text.as_bytes());
        }
        self.scroll_to_bottom();
    }

    /// Paste, bracketed when the program turned bracketed paste (mode 2004) on.
    pub(crate) fn paste(&mut self, text: &str) {
        let mut mode = ffi::GhosttyTerminalModeConfig {
            mode: 2004,
            value: false,
        };
        // SAFETY: a live terminal; `mode` is the documented in/out struct.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_MODE,
                (&mut mode as *mut ffi::GhosttyTerminalModeConfig).cast(),
            );
        }
        let mut data = text.as_bytes().to_vec();
        let mut out = vec![0u8; data.len() * 2 + 16];
        let mut len = 0usize;
        // SAFETY: both buffers are ours and sized as passed.
        let result = unsafe {
            ffi::ghostty_paste_encode(
                data.as_mut_ptr().cast(),
                data.len(),
                mode.value,
                out.as_mut_ptr().cast(),
                out.len(),
                &mut len,
            )
        };
        if result == ffi::GhosttyResult_GHOSTTY_SUCCESS {
            pty::write_all(self.hooks.fd, &out[..len]);
        }
        self.scroll_to_bottom();
    }

    /// Scroll the view through the scrollback (positive `lines` is older
    /// output). A full-screen program (less, man, vim: the alternate screen,
    /// which has no scrollback) that hasn't asked for the mouse gets the
    /// wheel as ↑ and ↓ instead, as in every terminal.
    pub(crate) fn scroll(&mut self, lines: f64) {
        self.scroll_rest += lines;
        let whole = self.scroll_rest.trunc();
        if whole == 0.0 {
            return;
        }
        self.scroll_rest -= whole;
        if self.alternate_screen() && !self.mouse_tracking() {
            let key = if whole > 0.0 { "up" } else { "down" };
            for _ in 0..(whole.abs() as usize).min(200) {
                self.key(key, None, false, false, false, false, false);
            }
            return;
        }
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA;
        how.value.delta = -(whole as isize);
        // SAFETY: a live terminal and a filled tagged union.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
    }

    /// A program asked for the mouse (any tracking mode).
    fn mouse_tracking(&self) -> bool {
        let mut on = false;
        // SAFETY: a live terminal; MOUSE_TRACKING is a bool.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING,
                (&mut on as *mut bool).cast(),
            );
        }
        on
    }

    pub(super) fn scroll_to_bottom(&mut self) {
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_BOTTOM;
        // SAFETY: as in scroll.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
        self.scroll_rest = 0.0;
    }
}
