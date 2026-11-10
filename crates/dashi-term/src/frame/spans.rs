//! One row's cells, read from the render state and joined into runs of
//! like-styled text.

use std::ffi::c_void;

use super::rgb;
use crate::ffi_generated as ffi;
use crate::protocol::Span;
use crate::vt::{Vt, sized};

impl Vt {
    /// The current row's cells as runs of like-styled text.
    ///
    /// # Safety
    /// The row iterator must be positioned on a row of the current render state.
    pub(super) unsafe fn row_spans(&mut self) -> Vec<Span> {
        let mut spans: Vec<Span> = Vec::new();
        // SAFETY: per the caller; out pointers match each data kind.
        unsafe {
            ffi::ghostty_render_state_row_get(
                self.rows_iter,
                ffi::GhosttyRenderStateRowData_GHOSTTY_RENDER_STATE_ROW_DATA_CELLS,
                (&mut self.cells as *mut ffi::GhosttyRenderStateRowCells).cast(),
            );
            // The column of the cell `next` moved to, and whether the last span is a run on the grid.
            let mut column: u16 = 0;
            let mut run = false;
            while ffi::ghostty_render_state_row_cells_next(self.cells) {
                let x = column;
                column = column.saturating_add(1);
                if let Some(span) = self.cell_span(x) {
                    push_cell(&mut spans, &mut run, span);
                }
            }
        }
        spans
    }

    /// The cell the row's cells iterator is on, as a one-cell span at column
    /// `x`; None for the spacer a wide character leaves behind.
    ///
    /// # Safety
    /// The cells iterator must be positioned on a cell of the current row.
    unsafe fn cell_span(&self, x: u16) -> Option<Span> {
        // SAFETY: per the caller; out pointers match each data kind.
        unsafe {
            let cell_get = |data, out: *mut c_void| {
                ffi::ghostty_render_state_row_cells_get(self.cells, data, out)
            };
            let mut codepoints = [0u32; 16];
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
                return None;
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
            let fg = (cell_get(
                ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR,
                (&mut color as *mut ffi::GhosttyColorRgb).cast(),
            ) == ffi::GhosttyResult_GHOSTTY_SUCCESS)
                .then(|| rgb(color));
            let bg = (cell_get(
                ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR,
                (&mut color as *mut ffi::GhosttyColorRgb).cast(),
            ) == ffi::GhosttyResult_GHOSTTY_SUCCESS)
                .then(|| rgb(color));
            let mut selected = false;
            cell_get(
                ffi::GhosttyRenderStateRowCellsData_GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_SELECTED,
                (&mut selected as *mut bool).cast(),
            );
            let (fg, bg) = if style.inverse {
                (
                    bg.or_else(|| Some(String::from("bg"))),
                    fg.or_else(|| Some(String::from("fg"))),
                )
            } else {
                (fg, bg)
            };
            let w = if wide == ffi::GhosttyCellWide_GHOSTTY_CELL_WIDE_WIDE {
                2
            } else {
                1
            };
            Some(Span {
                s: text,
                x,
                w,
                fg,
                bg,
                b: style.bold,
                i: style.italic,
                u: style.underline != 0,
                st: style.strikethrough,
                dim: style.faint,
                sel: selected,
            })
        }
    }
}

/// A character the monospace face draws one cell wide for sure: Latin,
/// Greek, Cyrillic, punctuation, box drawing and blocks. Anything else (CJK,
/// emoji, icon fonts, symbols from a fallback face) may be drawn wider or
/// narrower, so it gets a span of its own, pinned to its cells.
fn on_grid(c: char) -> bool {
    !c.is_control()
        && (c < '\u{0530}'
            || ('\u{2000}'..='\u{206f}').contains(&c)
            || ('\u{2500}'..='\u{259f}').contains(&c))
}

fn same_look(a: &Span, b: &Span) -> bool {
    (&a.fg, &a.bg, a.b, a.i, a.u, a.st, a.dim, a.sel)
        == (&b.fg, &b.bg, b.b, b.i, b.u, b.st, b.dim, b.sel)
}

/// Add one cell to its row's spans: it joins the last span when both are
/// runs of one-cell characters on the grid, side by side, drawn alike;
/// otherwise it starts a span. `run` says whether the last span is such a run.
pub(super) fn push_cell(spans: &mut Vec<Span>, run: &mut bool, cell: Span) {
    let mut chars = cell.s.chars();
    let plain = cell.w == 1 && chars.next().is_some_and(on_grid) && chars.next().is_none();
    match spans.last_mut() {
        Some(last) if *run && plain && last.x + last.w == cell.x && same_look(last, &cell) => {
            last.s.push_str(&cell.s);
            last.w += 1;
        }
        _ => {
            spans.push(cell);
            *run = plain;
        }
    }
}
