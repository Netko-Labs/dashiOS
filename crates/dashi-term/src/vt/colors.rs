//! The terminal's colors: setting the app's, and reading what is in effect.

use crate::ffi_generated as ffi;
use crate::protocol::{hex, parse_hex};
use crate::vt::Vt;

impl Vt {
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
