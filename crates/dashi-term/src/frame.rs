//! What to draw: libghostty-vt's render state, turned into rows of styled
//! spans for the Terminal app. Only dirty rows are sent, unless the whole
//! screen changed.

use std::ffi::c_void;

use crate::ffi_generated as ffi;
use crate::protocol::{Cursor, Frame, Line, Span, hex};
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
            let get =
                |data, out: *mut c_void| ffi::ghostty_render_state_get(self.render, data, out);
            let mut raw_cursor = sized!(ffi::GhosttyRenderStateCursor);
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_CURSOR,
                (&mut raw_cursor as *mut ffi::GhosttyRenderStateCursor).cast(),
            );
            let cursor = Cursor {
                x: raw_cursor.viewport_x,
                y: raw_cursor.viewport_y,
                visible: raw_cursor.visible && raw_cursor.viewport_has_value,
                style: cursor_style(raw_cursor.visual_style),
            };
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
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_COLS,
                (&mut frame.cols as *mut u16).cast(),
            );
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_ROWS,
                (&mut frame.rows as *mut u16).cast(),
            );
            let mut colors = sized!(ffi::GhosttyRenderStateColors);
            get(
                ffi::GhosttyRenderStateData_GHOSTTY_RENDER_STATE_DATA_COLORS,
                (&mut colors as *mut ffi::GhosttyRenderStateColors).cast(),
            );
            frame.fg = rgb(colors.foreground);
            frame.bg = rgb(colors.background);
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

            get(
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
                frame.lines.push(Line {
                    y,
                    spans: self.row_spans(),
                });
            }
            ffi::ghostty_render_state_clean(self.render);
            Some(frame)
        }
    }

    /// The current row's cells as runs of like-styled text.
    ///
    /// # Safety
    /// The row iterator must be positioned on a row of the current render state.
    unsafe fn row_spans(&mut self) -> Vec<Span> {
        let mut spans: Vec<Span> = Vec::new();
        // SAFETY: per the caller; out pointers match each data kind.
        unsafe {
            ffi::ghostty_render_state_row_get(
                self.rows_iter,
                ffi::GhosttyRenderStateRowData_GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                (&mut self.cells as *mut ffi::GhosttyRenderStateRowCells).cast(),
            );
            let cell_get = |data, out: *mut c_void| {
                ffi::ghostty_render_state_row_cells_get(self.cells, data, out)
            };
            let mut codepoints = [0u32; 16];
            while ffi::ghostty_render_state_row_cells_next(self.cells) {
                let mut raw: ffi::GhosttyCell = 0;
                cell_get(
                    ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW,
                    (&mut raw as *mut u64).cast(),
                );
                let mut wide: ffi::GhosttyCellWide = 0;
                ffi::ghostty_cell_get(
                    raw,
                    ffi::GhosttyCellData_GHOSTTY_CELL_DATA_WIDE,
                    (&mut wide as *mut i32).cast(),
                );
                if wide == ffi::GhosttyCellWide_GHOSTTY_CELL_WIDE_SPACER_TAIL
                    || wide == ffi::GhosttyCellWide_GHOSTTY_CELL_WIDE_SPACER_HEAD
                {
                    // The wide character before it covers this column.
                    continue;
                }
                let mut len: u32 = 0;
                cell_get(ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, (&mut len as *mut u32).cast());
                let mut text = String::new();
                if len == 0 {
                    text.push(' ');
                } else if len as usize <= codepoints.len() {
                    cell_get(ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF, codepoints.as_mut_ptr().cast());
                    text.extend(
                        codepoints[..len as usize]
                            .iter()
                            .filter_map(|c| char::from_u32(*c)),
                    );
                } else {
                    text.push('\u{fffd}');
                }
                let mut style = sized!(ffi::GhosttyStyle);
                cell_get(
                    ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE,
                    (&mut style as *mut ffi::GhosttyStyle).cast(),
                );
                let mut color = ffi::GhosttyColorRgb { r: 0, g: 0, b: 0 };
                let fg = (cell_get(ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, (&mut color as *mut ffi::GhosttyColorRgb).cast())
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS)
                    .then(|| rgb(color));
                let bg = (cell_get(ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, (&mut color as *mut ffi::GhosttyColorRgb).cast())
                    == ffi::GhosttyResult_GHOSTTY_SUCCESS)
                    .then(|| rgb(color));
                let mut selected = false;
                cell_get(ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_SELECTED, (&mut selected as *mut bool).cast());
                let (fg, bg) = if style.inverse {
                    (
                        bg.or_else(|| Some(String::from("bg"))),
                        fg.or_else(|| Some(String::from("fg"))),
                    )
                } else {
                    (fg, bg)
                };
                let span = Span {
                    s: text,
                    fg,
                    bg,
                    b: style.bold,
                    i: style.italic,
                    u: style.underline != 0,
                    st: style.strikethrough,
                    dim: style.faint,
                    sel: selected,
                };
                match spans.last_mut() {
                    Some(last)
                        if Span {
                            s: String::new(),
                            ..last.clone()
                        } == Span {
                            s: String::new(),
                            ..span.clone()
                        } =>
                    {
                        last.s.push_str(&span.s)
                    }
                    _ => spans.push(span),
                }
            }
        }
        spans
    }
}
