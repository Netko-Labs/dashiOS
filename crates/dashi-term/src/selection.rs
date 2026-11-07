//! Selection: a press, drag, double or triple click on the grid picks
//! text (through libghostty-vt's selection API), and copy formats it. A
//! plain click selects nothing: a drag that never leaves the cell it began
//! in used to leave that one cell selected, a stray block in the selection's
//! color (kombu, in Dark Mode) wherever the grid was clicked.

use std::ffi::c_void;

use crate::ffi_generated as ffi;
use crate::protocol::Phase;
use crate::vt::{Vt, sized, sized_free};

/// Where a drag selection started: the grid's place, and the viewport cell
/// the press was on.
#[derive(Clone, Copy)]
pub(crate) struct Anchor {
    at: ffi::GhosttyGridRef,
    cell: (u16, u16),
}

/// Whether the pointer, pressed on cell `from`, is now on another cell, so
/// there is something to select.
fn drags(from: (u16, u16), to: (u16, u16)) -> bool {
    from != to
}

impl Vt {
    fn grid_ref(&self, x: u16, y: u16) -> Option<ffi::GhosttyGridRef> {
        let mut point: ffi::GhosttyPoint = sized_free();
        point.tag = ffi::GhosttyPointTag_GHOSTTY_POINT_TAG_VIEWPORT;
        point.value.coordinate = ffi::GhosttyPointCoordinate { x, y: y.into() };
        let mut out = sized!(ffi::GhosttyGridRef);
        // SAFETY: a live terminal; `out` is a sized grid ref.
        let result = unsafe { ffi::ghostty_terminal_grid_ref(self.term, point, &mut out) };
        (result == ffi::GhosttyResult_GHOSTTY_SUCCESS).then_some(out)
    }

    fn set_selection(&mut self, selection: Option<&ffi::GhosttySelection>) {
        let value = selection.map_or(std::ptr::null(), |s| {
            s as *const ffi::GhosttySelection as *const c_void
        });
        // SAFETY: a live terminal; null clears the selection.
        unsafe {
            ffi::ghostty_terminal_set(
                self.term,
                ffi::GhosttyTerminalOption_GHOSTTY_TERMINAL_OPT_SELECTION,
                value,
            )
        };
    }

    /// The pointer on the grid: a press starts a selection (two clicks pick a
    /// word, three a line), a drag to another cell extends it.
    pub(crate) fn select(&mut self, phase: Phase, x: u16, y: u16, clicks: u8) {
        let Some(at) = self.grid_ref(x, y) else {
            return;
        };
        let mut selection = sized!(ffi::GhosttySelection);
        match (phase, clicks) {
            (Phase::Down, 2) => {
                let mut options = sized!(ffi::GhosttyTerminalSelectWordOptions);
                options.ref_ = at;
                // SAFETY: live terminal; options filled; out is a sized selection.
                if unsafe { ffi::ghostty_terminal_select_word(self.term, &options, &mut selection) }
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS
                {
                    self.set_selection(Some(&selection));
                }
                self.anchor = None;
            }
            (Phase::Down, n) if n >= 3 => {
                let mut options = sized!(ffi::GhosttyTerminalSelectLineOptions);
                options.ref_ = at;
                // SAFETY: as above.
                if unsafe { ffi::ghostty_terminal_select_line(self.term, &options, &mut selection) }
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS
                {
                    self.set_selection(Some(&selection));
                }
                self.anchor = None;
            }
            (Phase::Down, _) => {
                self.anchor = Some(Anchor { at, cell: (x, y) });
                self.set_selection(None);
            }
            (Phase::Move, _) | (Phase::Up, _) => {
                if let Some(anchor) = self.anchor {
                    if drags(anchor.cell, (x, y)) {
                        selection.start = anchor.at;
                        selection.end = at;
                        self.set_selection(Some(&selection));
                    } else {
                        self.set_selection(None);
                    }
                }
                if phase == Phase::Up {
                    self.anchor = None;
                }
            }
        }
    }

    pub(crate) fn select_all(&mut self) {
        let mut selection = sized!(ffi::GhosttySelection);
        // SAFETY: live terminal; sized out value.
        if unsafe { ffi::ghostty_terminal_select_all(self.term, &mut selection) }
            == ffi::GhosttyResult_GHOSTTY_SUCCESS
        {
            self.set_selection(Some(&selection));
        }
    }

    /// The selected text, plain, trailing spaces trimmed.
    pub(crate) fn copy(&self) -> String {
        let mut options = sized!(ffi::GhosttyTerminalSelectionFormatOptions);
        options.emit = ffi::GhosttyFormatterFormat_GHOSTTY_FORMATTER_FORMAT_PLAIN;
        options.trim = true;
        options.unwrap = true;
        let mut ptr: *mut u8 = std::ptr::null_mut();
        let mut len = 0usize;
        // SAFETY: live terminal; libghostty-vt allocates the buffer, freed below with its allocator.
        unsafe {
            if ffi::ghostty_terminal_selection_format_alloc(
                self.term,
                std::ptr::null(),
                options,
                &mut ptr,
                &mut len,
            ) != ffi::GhosttyResult_GHOSTTY_SUCCESS
                || ptr.is_null()
            {
                return String::new();
            }
            let text = String::from_utf8_lossy(std::slice::from_raw_parts(ptr, len)).into_owned();
            ffi::ghostty_free(std::ptr::null(), ptr, len);
            text
        }
    }
}

#[cfg(test)]
mod tests {
    use super::drags;

    #[test]
    fn a_click_selects_nothing_and_a_drag_to_another_cell_does() {
        assert!(!drags((61, 19), (61, 19)));
        assert!(drags((61, 19), (62, 19)));
        assert!(drags((61, 19), (61, 18)));
    }
}
