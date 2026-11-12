//! What to draw: libghostty-vt's render state, turned into rows of styled
//! spans for the Terminal app. Only dirty rows are sent, unless the whole
//! screen changed.

mod spans;
#[cfg(test)]
mod tests;

use std::ffi::c_void;

use crate::ffi_generated as ffi;
use crate::protocol::{Cursor, Frame, Line, hex};
use crate::vt::{Vt, sized};

fn rgb(color: ffi::GhosttyColorRgb) -> String {
    hex(color.r, color.g, color.b)
}

fn cursor_style(style: ffi::GhosttyRenderStateCursorVisualStyle) -> &'static str {
    match style {
        ffi::GhosttyRenderStateCursorVisualStyle_GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR => "bar",
        ffi::GhosttyRenderStateCursorVisualStyle_GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE => "underline",
        ffi::GhosttyRenderStateCursorVisualStyle_GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK_HOLLOW => "hollow",
        _ => "block",
    }
}

impl Vt {
    /// The frame since the last one, or None if nothing changed. `force` sends every row.
    pub(crate) fn frame(&mut self, force: bool) -> Option<Frame> {
        // SAFETY: all handles are live and owned by this Vt; every out pointer
        // has the type its data kind documents; cell data is read before the
        // next update.
        unsafe {
            ffi::ghostty_render_state_update(self.render, self.term);
            let mut dirty: ffi::GhosttyRenderStateDirty = 0;
            ffi::ghostty_render_state_get(
                self.render,
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_DIRTY,
                (&mut dirty as *mut i32).cast(),
            );
            let cursor = self.render_cursor();
            // A cursor that only moved (← in a shell's line editor) dirties no
            // row, yet the app must draw it where it went.
            let clean = dirty == ffi::GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FALSE;
            if clean && !force && self.sent_cursor.as_ref() == Some(&cursor) {
                return None;
            }
            self.sent_cursor = Some(cursor.clone());
            let full =
                force || dirty == ffi::GhosttyRenderStateDirty_GHOSTTY_RENDER_STATE_DIRTY_FULL;
            let mut frame = Frame {
                full,
                cursor,
                ..Frame::default()
            };
            self.fill_screen_facts(&mut frame);
            frame.lines = self.rows_to_send(full);
            ffi::ghostty_render_state_clean(self.render);
            Some(frame)
        }
    }

    /// The render state's cursor, as the app takes it.
    ///
    /// # Safety
    /// The render state must have been updated from the terminal.
    unsafe fn render_cursor(&self) -> Cursor {
        let mut raw_cursor = sized!(ffi::GhosttyRenderStateCursor);
        // SAFETY: per the caller; the out value is a sized cursor.
        unsafe {
            ffi::ghostty_render_state_get(
                self.render,
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_CURSOR,
                (&mut raw_cursor as *mut ffi::GhosttyRenderStateCursor).cast(),
            );
        }
        Cursor {
            x: raw_cursor.viewport_x,
            y: raw_cursor.viewport_y,
            visible: raw_cursor.visible && raw_cursor.viewport_has_value,
            style: cursor_style(raw_cursor.visual_style),
        }
    }

    /// The grid size, colors, scrollback, marks and selection flag of `frame`.
    ///
    /// # Safety
    /// The render state must have been updated from the terminal.
    unsafe fn fill_screen_facts(&self, frame: &mut Frame) {
        // SAFETY: per the caller; every out pointer has the type its data kind documents.
        unsafe {
            let get =
                |data, out: *mut c_void| ffi::ghostty_render_state_get(self.render, data, out);
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_COLS,
                (&mut frame.cols as *mut u16).cast(),
            );
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROWS,
                (&mut frame.rows as *mut u16).cast(),
            );
            (frame.ink, frame.ground) = self.colors();
            let mut bar = ffi::GhosttyTerminalScrollbar {
                total: 0,
                offset: 0,
                len: 0,
            };
            ffi::ghostty_terminal_get(
                self.term,
                ffi::GhosttyTerminalData_GHOSTTY_TERMINAL_DATA_SCROLLBAR,
                (&mut bar as *mut ffi::GhosttyTerminalScrollbar).cast(),
            );
            frame.scroll = [bar.total, bar.offset, bar.len];
            frame.marks = self.marks_in_view(bar.offset, bar.len);
            frame.selected = self.has_selection();
        }
    }

    /// The rows to send: all of them when `full`, else the dirty ones.
    ///
    /// # Safety
    /// The render state must have been updated from the terminal.
    unsafe fn rows_to_send(&mut self, full: bool) -> Vec<Line> {
        let mut lines = Vec::new();
        // SAFETY: per the caller; the iterator is filled before it is walked.
        unsafe {
            ffi::ghostty_render_state_get(
                self.render,
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR,
                (&mut self.rows_iter as *mut ffi::GhosttyRenderStateRowIterator).cast(),
            );
            let mut y: u16 = 0;
            let mut index: u16 = 0;
            loop {
                let more = if full {
                    let more = ffi::ghostty_render_state_row_iterator_next(self.rows_iter);
                    y = index;
                    index += 1;
                    more
                } else {
                    ffi::ghostty_render_state_row_iterator_next_dirty(self.rows_iter, &mut y)
                };
                if !more {
                    break;
                }
                lines.push(Line {
                    y,
                    spans: self.row_spans(),
                });
            }
        }
        lines
    }
}
