/**
 * The widget column's grid (round three, from Material): four columns of
 * 80-point cells, 12 apart, in the area's 356 column. Each size is a span;
 * widgets go in the person's order, each in the first place it fits, so two
 * smalls that come next to each other sit side by side.
 */

import type { Placed, Placement, WidgetSize } from "./types.ts";

export const GRID = { cell: 80, gap: 12, columns: 4 } as const;
/** The column's width: 4 × 80 + 3 × 12. */
export const COLUMN_WIDTH = GRID.columns * GRID.cell + (GRID.columns - 1) * GRID.gap;

/** Each size's span, in cells: columns × rows. */
export const SPANS: Readonly<Record<WidgetSize, { cols: number; rows: number }>> = {
  mini: { cols: 1, rows: 1 },
  compact: { cols: 2, rows: 1 },
  small: { cols: 2, rows: 2 },
  strip: { cols: 4, rows: 1 },
  wide: { cols: 4, rows: 2 },
  tall: { cols: 2, rows: 4 },
  large: { cols: 4, rows: 4 },
};

/** The order sizes grow in (⌥⇧ arrows step through a widget's own sizes in this order). */
export const SIZE_ORDER: readonly WidgetSize[] = ["mini", "compact", "small", "strip", "wide", "tall", "large"];

/** The words for a size: "Small". */
export function sizeWord(size: WidgetSize): string {
  return size.charAt(0).toUpperCase() + size.slice(1);
}

/** Points across `cells` cells. */
export const span = (cells: number): number => cells * GRID.cell + (cells - 1) * GRID.gap;

/** Every placement's box: first fit, row by row, in the person's order. */
export function packColumn(placements: readonly Placement[]): Placed[] {
  const taken: boolean[][] = [];
  const free = (row: number, col: number): boolean => !taken[row]?.[col];
  const fits = (row: number, col: number, cols: number, rows: number): boolean => {
    if (col + cols > GRID.columns) return false;
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) if (!free(r, c)) return false;
    return true;
  };
  // A widget never goes above one placed before it: order is the person's, top to bottom.
  let floor = 0;
  const out: Placed[] = [];
  for (const placement of placements) {
    const { cols, rows } = SPANS[placement.size];
    let at: { row: number; col: number } | null = null;
    for (let row = floor; at === null; row++) for (let col = 0; col < GRID.columns && at === null; col++) if (fits(row, col, cols, rows)) at = { row, col };
    for (let r = at.row; r < at.row + rows; r++) {
      taken[r] ??= [];
      for (let c = at.col; c < at.col + cols; c++) (taken[r] as boolean[])[c] = true;
    }
    floor = at.row;
    out.push({ placement, x: at.col * (GRID.cell + GRID.gap), y: at.row * (GRID.cell + GRID.gap), width: span(cols), height: span(rows) });
  }
  return out;
}

/** The column's height once packed. */
export function columnHeight(placed: readonly Placed[]): number {
  return placed.reduce((most, each) => Math.max(most, each.y + each.height), 0);
}
