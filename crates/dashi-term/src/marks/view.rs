//! Reading the terminal for marks and screens: the marks in view, jumping
//! between prompts, selecting a command's output, and the folder the shell
//! named.

use super::point;
use crate::ffi_generated as ffi;
use crate::protocol::Mark;
use crate::vt::{Vt, sized, sized_free};

impl Vt {
    /// The commands' marks on rows `top..top + rows` of the screen (the view),
    /// as view rows; none while a program has the alternate screen.
    pub(crate) fn marks_in_view(&self, top: u64, rows: u64) -> Vec<Mark> {
        if self.alternate_screen() {
            return Vec::new();
        }
        let mut seen = Vec::new();
        for mark in self.marks.list.iter().rev().filter(|mark| mark.ran) {
            let Some(y) = screen_row(mark.at) else {
                continue;
            };
            // Older marks are higher up: none of them is in view either.
            if y < top {
                break;
            }
            if y < top + rows {
                seen.push(Mark {
                    y: (y - top) as u16,
                    failed: mark.failed,
                });
            }
        }
        seen.reverse();
        seen
    }

    /// Scroll so the prompt `prompts` away from the view's top is at it (❖↑ -1, ❖↓ 1).
    pub(crate) fn jump(&mut self, prompts: i32) {
        let mut how: ffi::GhosttyTerminalScrollViewport = sized_free();
        how.tag = ffi::GhosttyTerminalScrollViewportTag_GHOSTTY_SCROLL_VIEWPORT_DELTA_PROMPT;
        how.value.delta_prompt = prompts as isize;
        // SAFETY: a live terminal and a filled tagged union.
        unsafe { ffi::ghostty_terminal_scroll_viewport(self.term, how) };
    }

    /// Select the output of the command marked on view row `y`.
    pub(crate) fn select_output(&mut self, y: u16) {
        let row = self.viewport_top() + u64::from(y);
        if !self
            .marks
            .list
            .iter()
            .any(|mark| mark.ran && screen_row(mark.at) == Some(row))
        {
            return;
        }
        // The output starts on the row after the command; the prompt itself isn't output.
        let below = point(
            ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_SCREEN,
            0,
            (row + 1) as u32,
        );
        let mut at = sized!(ffi::GhosttyGridRef);
        let mut selection = sized!(ffi::GhosttySelection);
        // SAFETY: a live terminal; `at` and `selection` are sized out values used before the next write.
        unsafe {
            if ffi::ghostty_terminal_grid_ref(self.term, below, &mut at)
                == ffi::GhosttyResult_GHOSTTY_SUCCESS
                && ffi::ghostty_terminal_select_output(self.term, at, &mut selection)
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS
            {
                ffi::ghostty_terminal_set(
                    self.term,
                    ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_SELECTION,
                    (&selection as *const ffi::GhosttySelection).cast(),
                );
            }
        }
    }

    /// The view's first row, in screen coordinates.
    fn viewport_top(&self) -> u64 {
        let mut bar = ffi::GhosttyTerminalScrollbar {
            total: 0,
            offset: 0,
            len: 0,
        };
        // SAFETY: a live terminal; SCROLLBAR is a GhosttyTerminalScrollbar.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SCROLLBAR,
                (&mut bar as *mut ffi::GhosttyTerminalScrollbar).cast(),
            );
        }
        bar.offset
    }

    pub(crate) fn alternate_screen(&self) -> bool {
        let mut screen: ffi::GhosttyTerminalScreen = 0;
        // SAFETY: a live terminal; ACTIVE_SCREEN is a GhosttyTerminalScreen.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN,
                (&mut screen as *mut ffi::GhosttyTerminalScreen).cast(),
            );
        }
        screen == ffi::GhosttyTerminalScreen_GHOSTTY_TERMINAL_SCREEN_ALTERNATE
    }

    /// The folder the shell last named (OSC 7), as it sent it.
    pub(super) fn pwd(&self) -> Option<String> {
        let mut pwd = ffi::GhosttyString {
            ptr: std::ptr::null(),
            len: 0,
        };
        // SAFETY: a live terminal; the borrowed string is copied before the next terminal call.
        unsafe {
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_PWD,
                (&mut pwd as *mut ffi::GhosttyString).cast(),
            );
            if pwd.ptr.is_null() || pwd.len == 0 {
                return None;
            }
            Some(String::from_utf8_lossy(std::slice::from_raw_parts(pwd.ptr, pwd.len)).into_owned())
        }
    }
}

/// A tracked mark's row in screen coordinates (the scrollback's top is 0),
/// or None once its row has left the scrollback.
fn screen_row(at: ffi::GhosttyTrackedGridRef) -> Option<u64> {
    let mut out = ffi::GhosttyPointCoordinate { x: 0, y: 0 };
    // SAFETY: the ref is live (owned by Marks); `out` is one coordinate.
    let result = unsafe {
        ffi::ghostty_tracked_grid_ref_point(
            at,
            ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_SCREEN,
            &mut out,
        )
    };
    (result == ffi::GhosttyResult_GHOSTTY_SUCCESS).then_some(u64::from(out.y))
}
