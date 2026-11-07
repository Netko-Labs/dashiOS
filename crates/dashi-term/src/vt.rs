//! The terminal: libghostty-vt's state, fed by the PTY, and the input that
//! goes back to it (encoded keys, paste, the terminal's own replies).
//! Everything libghostty-vt is touched from here and `frame.rs`, on the
//! main thread only.

use std::cell::Cell;
use std::ffi::c_void;
use std::os::fd::RawFd;

use crate::ffi_generated as ffi;
use crate::keys;
use crate::protocol::{hex, parse_hex};
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

/// What the terminal's callbacks reach: the PTY, and what happened.
struct Hooks {
    fd: RawFd,
    title_changed: Cell<bool>,
    bell: Cell<bool>,
}

unsafe extern "C" fn write_pty(
    _t: ffi::GhosttyTerminal,
    user: *mut c_void,
    data: *const u8,
    len: usize,
) {
    if user.is_null() || data.is_null() {
        return;
    }
    // SAFETY: `user` is the boxed Hooks the terminal was given, alive as long as the Vt; `data` holds `len` bytes.
    let (hooks, bytes) = unsafe {
        (
            &*(user as *const Hooks),
            std::slice::from_raw_parts(data, len),
        )
    };
    pty::write_all(hooks.fd, bytes);
}

unsafe extern "C" fn title_changed(_t: ffi::GhosttyTerminal, user: *mut c_void) {
    // SAFETY: as in write_pty.
    if let Some(hooks) = unsafe { (user as *const Hooks).as_ref() } {
        hooks.title_changed.set(true);
    }
}

unsafe extern "C" fn bell(_t: ffi::GhosttyTerminal, user: *mut c_void) {
    // SAFETY: as in write_pty.
    if let Some(hooks) = unsafe { (user as *const Hooks).as_ref() } {
        hooks.bell.set(true);
    }
}

pub(crate) struct Vt {
    pub(crate) term: ffi::GhosttyTerminal,
    pub(crate) render: ffi::GhosttyRenderState,
    pub(crate) rows_iter: ffi::GhosttyRenderStateRowIterator,
    pub(crate) cells: ffi::GhosttyRenderStateRowCells,
    encoder: ffi::GhosttyKeyEncoder,
    event: ffi::GhosttyKeyEvent,
    hooks: Box<Hooks>,
    /// Where a drag selection started.
    pub(crate) anchor: Option<crate::selection::Anchor>,
    /// Wheel lines not yet scrolled (touchpads give fractions).
    scroll_rest: f64,
    /// The cursor as last sent: a move alone dirties no row, but needs a frame.
    pub(crate) sent_cursor: Option<crate::protocol::Cursor>,
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
        let hooks = Box::new(Hooks {
            fd,
            title_changed: Cell::new(false),
            bell: Cell::new(false),
        });
        let mut vt = Vt {
            term: std::ptr::null_mut(),
            render: std::ptr::null_mut(),
            rows_iter: std::ptr::null_mut(),
            cells: std::ptr::null_mut(),
            encoder: std::ptr::null_mut(),
            event: std::ptr::null_mut(),
            hooks,
            anchor: None,
            scroll_rest: 0.0,
            sent_cursor: None,
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
            let user = &*vt.hooks as *const Hooks as *const c_void;
            let write: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void, *const u8, usize) =
                write_pty;
            let title: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void) = title_changed;
            let ring: unsafe extern "C" fn(ffi::GhosttyTerminal, *mut c_void) = bell;
            ok(
                ffi::ghostty_terminal_set(
                    vt.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_USERDATA,
                    user,
                ),
                "userdata",
            )?;
            ok(
                ffi::ghostty_terminal_set(
                    vt.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_WRITE_PTY,
                    write as *const c_void,
                ),
                "write_pty",
            )?;
            ok(
                ffi::ghostty_terminal_set(
                    vt.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
                    title as *const c_void,
                ),
                "title",
            )?;
            ok(
                ffi::ghostty_terminal_set(
                    vt.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_BELL,
                    ring as *const c_void,
                ),
                "bell",
            )?;
        }
        Ok(vt)
    }

    /// The shell's output.
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        // SAFETY: a live terminal and a live slice.
        unsafe { ffi::ghostty_terminal_vt_write(self.term, bytes.as_ptr(), bytes.len()) };
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

    /// Scroll the view through the scrollback (positive `lines` is older output).
    pub(crate) fn scroll(&mut self, lines: f64) {
        self.scroll_rest += lines;
        let whole = self.scroll_rest.trunc();
        if whole == 0.0 {
            return;
        }
        self.scroll_rest -= whole;
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA;
        how.value.delta = -(whole as isize);
        // SAFETY: a live terminal and a filled tagged union.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
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
