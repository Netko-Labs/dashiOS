//! The terminal: libghostty-vt's state, fed by the PTY, and the input that
//! goes back to it (encoded keys, paste, the terminal's own replies).
//! Everything libghostty-vt is touched from here, `frame.rs`, `marks.rs`
//! and `selection.rs`, on the main thread only.

mod colors;
mod input;
#[cfg(test)]
mod tests;

use std::os::fd::RawFd;

use crate::ffi_generated as ffi;
use crate::hooks::{self, Hooks};
use crate::marks::{self, Marks};
use crate::protocol::Output;
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
    pub(crate) anchor: Option<crate::selection::Anchor>,
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
