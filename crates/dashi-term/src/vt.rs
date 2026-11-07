//! The terminal: libghostty-vt's state, fed by the PTY, and the input that
//! goes back to it (encoded keys, paste, the terminal's own replies).
//! Everything libghostty-vt is touched from here, `frame.rs`, `marks.rs`
//! and `selection.rs`, on the main thread only.

use std::os::fd::RawFd;

use crate::ffi_generated as ffi;
use crate::hooks::{self, Hooks};
use crate::keys;
use crate::marks::{self, Marks};
use crate::protocol::{Output, hex, parse_hex};
use crate::pty;

/// A libghostty-vt struct versioned by its `size` field (GHOSTTY_INIT_SIZED).
macro_rules! sized {
    ($t:ty) => {{
        // SAFETY: these are plain C structs; all-zero is a valid empty value.
        #[allow(unused_unsafe)]
        let mut value: $t = unsafe { std::mem::zeroed() };
        value.size = std::mem::size_of::<$t>();
        value
    }};
}
pub(crate) use sized;

pub(crate) struct Vt {
    pub(crate) term: ffi::GhosttyTerminal,
    pub(crate) render: ffi::GhosttyRenderState,
    pub(crate) rows_iter: ffi::GhosttyRenderStateRowIterator,
    pub(crate) cells: ffi::GhosttyRenderStateRowCells,
    encoder: ffi::GhosttyKeyEncoder,
    event: ffi::GhosttyKeyEvent,
    pub(crate) hooks: Box<Hooks>,
    /// Where a drag selection started.
    pub(crate) anchor: Option<ffi::GhosttyGridRef>,
    /// Wheel lines not yet scrolled (touchpads give fractions).
    scroll_rest: f64,
    /// The cursor as last sent: a move alone dirties no row, but needs a frame.
    pub(crate) sent_cursor: Option<crate::protocol::Cursor>,
    /// Each command's prompt row (marks.rs).
    pub(crate) marks: Marks,
    /// What the shell integration said, for the app (`take_outbox`).
    pub(crate) outbox: Vec<Output>,
    /// The last output ended with ESC: an ST may be finishing in the next.
    esc_before: bool,
}

fn ok(result: ffi::GhosttyResult, what: &str) -> Result<(), String> {
    if result == ffi::GhosttyResult_GHOSTTY_SUCCESS {
        Ok(())
    } else {
        Err(format!("{what}: libghostty-vt error {result}"))
    }
}

impl Vt {
    pub(crate) fn new(cols: u16, rows: u16, fd: RawFd) -> Result<Vt, String> {
        let mut vt = Vt {
            term: std::ptr::null_mut(),
            render: std::ptr::null_mut(),
            rows_iter: std::ptr::null_mut(),
            cells: std::ptr::null_mut(),
            encoder: std::ptr::null_mut(),
            event: std::ptr::null_mut(),
            hooks: Box::new(Hooks::new(fd)),
            anchor: None,
            scroll_rest: 0.0,
            sent_cursor: None,
            marks: Marks::default(),
            outbox: Vec::new(),
            esc_before: false,
        };
        // SAFETY: each constructor writes a fresh handle into a field we own; Drop frees them.
        unsafe {
            ok(
                ffi::ghostty_terminal_new(std::ptr::null(), &mut vt.term, cols.max(1), rows.max(1)),
                "terminal",
            )?;
            ok(
                ffi::ghostty_render_state_new(std::ptr::null(), &mut vt.render),
                "render state",
            )?;
            ok(
                ffi::ghostty_render_state_row_iterator_new(std::ptr::null(), &mut vt.rows_iter),
                "row iterator",
            )?;
            ok(
                ffi::ghostty_render_state_row_cells_new(std::ptr::null(), &mut vt.cells),
                "row cells",
            )?;
            ok(
                ffi::ghostty_key_encoder_new(std::ptr::null(), &mut vt.encoder),
                "key encoder",
            )?;
            ok(
                ffi::ghostty_key_event_new(std::ptr::null(), &mut vt.event),
                "key event",
            )?;
        }
        ok(hooks::install(vt.term, &vt.hooks), "callbacks")?;
        Ok(vt)
    }

    /// The shell's output, a piece at a time: each piece ends where an OSC
    /// sequence may (marks.rs), so a mark lands on the row the cursor was on
    /// when the shell sent it, not where the rest of the output left it.
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        for piece in marks::pieces(bytes, self.esc_before) {
            // SAFETY: a live terminal and a live slice.
            unsafe { ffi::ghostty_terminal_vt_write(self.term, piece.as_ptr(), piece.len()) };
            self.after_piece();
        }
        if let Some(last) = bytes.last() {
            self.esc_before = *last == 0x1b;
        }
    }

    /// What the shell integration said since the last call (marks.rs).
    pub(crate) fn take_outbox(&mut self) -> Vec<Output> {
        std::mem::take(&mut self.outbox)
    }

    /// ❖K: the scrollback goes, and at a prompt the screen too, the shell
    /// drawing its prompt again at the top (Ctrl+L). A program in front keeps
    /// its screen: Ctrl+L would be a key for it.
    pub(crate) fn clear(&mut self) {
        let mut at_prompt = false;
        // SAFETY: a live terminal; CURSOR_AT_PROMPT is a bool.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_CURSOR_AT_PROMPT,
                (&mut at_prompt as *mut bool).cast(),
            );
        }
        let erase: &[u8] = if at_prompt {
            b"\x1b[H\x1b[2J\x1b[3J"
        } else {
            b"\x1b[3J"
        };
        // SAFETY: a live terminal and a live slice; this is the terminal's own doing, not the shell's output.
        unsafe { ffi::ghostty_terminal_vt_write(self.term, erase.as_ptr(), erase.len()) };
        if at_prompt {
            pty::write_all(self.hooks.fd, b"\x0c");
        }
        self.scroll_to_bottom();
    }

    /// Whether anything is selected, in view or not.
    pub(crate) fn has_selection(&self) -> bool {
        let mut selection = sized!(ffi::GhosttySelection);
        // SAFETY: a live terminal; the out value is a sized selection, read for its result only.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SELECTION,
                (&mut selection as *mut ffi::GhosttySelection).cast(),
            ) == ffi::GhosttyResult_GHOSTTY_SUCCESS
        }
    }

    pub(crate) fn resize(&mut self, cols: u16, rows: u16, cell_w: u16, cell_h: u16) {
        // SAFETY: a live terminal.
        unsafe {
            ffi::ghostty_terminal_resize(
                self.term,
                cols.max(1),
                rows.max(1),
                cell_w.into(),
                cell_h.into(),
            )
        };
        self.anchor = None;
    }

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

    fn scroll_to_bottom(&mut self) {
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_BOTTOM;
        // SAFETY: as in scroll.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
        self.scroll_rest = 0.0;
    }

    /// The title, when a program changed it since the last call.
    pub(crate) fn take_title(&self) -> Option<String> {
        if !self.hooks.title_changed.replace(false) {
            return None;
        }
        let mut title = ffi::GhosttyString {
            ptr: std::ptr::null(),
            len: 0,
        };
        // SAFETY: live terminal; the borrowed string is copied before the next terminal call.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_TITLE,
                (&mut title as *mut ffi::GhosttyString).cast(),
            );
            if title.ptr.is_null() {
                return Some(String::new());
            }
            Some(
                String::from_utf8_lossy(std::slice::from_raw_parts(title.ptr, title.len))
                    .into_owned(),
            )
        }
    }

    pub(crate) fn take_bell(&self) -> bool {
        self.hooks.bell.replace(false)
    }

    /// The terminal's default ink, ground, and first 16 palette entries (the
    /// rest of the 256 stay libghostty-vt's). Colors a program set itself
    /// (OSC 4, 10, 11) keep winning; a bad hex leaves that color as it was.
    pub(crate) fn set_colors(&mut self, fg: &str, bg: &str, palette: &[String]) {
        let rgb = |text: &str| parse_hex(text).map(|(r, g, b)| ffi::GhosttyColorRgb { r, g, b });
        let mut entries = [ffi::GhosttyColorRgb { r: 0, g: 0, b: 0 }; 256];
        // SAFETY: a live terminal; every pointer is to a value of the type the
        // option documents (one color, or exactly 256), alive for the call.
        unsafe {
            for (option, color) in [
                (
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND,
                    rgb(fg),
                ),
                (
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND,
                    rgb(bg),
                ),
            ] {
                if let Some(color) = color {
                    ffi::ghostty_terminal_set(
                        self.term,
                        option,
                        (&color as *const ffi::GhosttyColorRgb).cast(),
                    );
                }
            }
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_COLOR_PALETTE_DEFAULT,
                entries.as_mut_ptr().cast(),
            );
            for (entry, color) in entries.iter_mut().zip(palette.iter().take(16)) {
                if let Some(color) = rgb(color) {
                    *entry = color;
                }
            }
            ffi::ghostty_terminal_set(
                self.term,
                ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_COLOR_PALETTE,
                entries.as_ptr().cast(),
            );
        }
    }

    /// The terminal's ink and ground as they are now (`#rrggbb`): a program's
    /// own (OSC 10, 11), else the defaults; None while neither is set.
    pub(crate) fn colors(&self) -> (Option<String>, Option<String>) {
        let get = |data| {
            let mut color = ffi::GhosttyColorRgb { r: 0, g: 0, b: 0 };
            // SAFETY: a live terminal; the out pointer is one GhosttyColorRgb.
            let result = unsafe {
                ffi::ghostty_terminal_get(
                    self.term,
                    data,
                    (&mut color as *mut ffi::GhosttyColorRgb).cast(),
                )
            };
            (result == ffi::GhosttyResult_GHOSTTY_SUCCESS).then(|| hex(color.r, color.g, color.b))
        };
        (
            get(ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_COLOR_FOREGROUND),
            get(ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_COLOR_BACKGROUND),
        )
    }
}

/// A zeroed C struct without a `size` field (tagged unions, points).
pub(crate) fn sized_free<T: Copy>() -> T {
    // SAFETY: only used for plain C structs and unions where all-zero is valid.
    unsafe { std::mem::zeroed() }
}

impl Drop for Vt {
    fn drop(&mut self) {
        // SAFETY: each handle was made by its constructor and is freed once; the free functions accept null.
        unsafe {
            ffi::ghostty_key_event_free(self.event);
            ffi::ghostty_key_encoder_free(self.encoder);
            ffi::ghostty_render_state_row_cells_free(self.cells);
            ffi::ghostty_render_state_row_iterator_free(self.rows_iter);
            ffi::ghostty_render_state_free(self.render);
            ffi::ghostty_terminal_free(self.term);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Vt;

    /// What the terminal wrote to its PTY, through a pipe standing in for one.
    fn written(feed: &[u8], scroll: f64) -> Vec<u8> {
        let mut ends = [0; 2];
        // SAFETY: a fresh pipe; both ends are closed below.
        assert_eq!(unsafe { libc::pipe(ends.as_mut_ptr()) }, 0);
        let mut vt = Vt::new(20, 5, ends[1]).expect("a terminal");
        vt.feed(feed);
        vt.scroll(scroll);
        drop(vt);
        // SAFETY: our own pipe's ends.
        unsafe { libc::close(ends[1]) };
        let mut out = vec![0u8; 256];
        // SAFETY: reading into our own buffer from our own pipe.
        let n = unsafe { libc::read(ends[0], out.as_mut_ptr().cast(), out.len()) };
        // SAFETY: as above.
        unsafe { libc::close(ends[0]) };
        out.truncate(n.max(0) as usize);
        out
    }

    #[test]
    fn the_wheel_is_arrows_for_a_full_screen_program_without_the_mouse() {
        assert_eq!(written(b"\x1b[?1049h", 2.0), b"\x1b[A\x1b[A");
        assert_eq!(written(b"\x1b[?1049h", -1.0), b"\x1b[B");
        // In the shell's own screen the wheel scrolls the view and writes nothing.
        assert!(written(b"", 2.0).is_empty());
        // A program that asked for the mouse gets no arrows.
        assert!(written(b"\x1b[?1049h\x1b[?1000h", 2.0).is_empty());
    }
}
