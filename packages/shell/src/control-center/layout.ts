/**
 * Control Center's grid, as data (docs/design.html, "Control Center"): four
 * columns of 56-point rows, and the controls in the order the person put
 * them, each in one of the sizes it offers. Pure: the panel and Settings ›
 * Control Center draw what `pack` places, and edit mode changes the layout
 * only through the functions here.
 *
 * - **round** 1 × 1: the glyph with a word under it.
 * - **wide** 2 × 1: a knob and the label (the knob toggles, the label opens the page).
 * - **tall** 1 × 3 and **flat** 4 × 1: a slider standing or lying; two tall
 *   ones side by side are the pair the default layout has.
 *
 * A control whose hardware or applet isn't there keeps its place in the
 * order but isn't packed, so it leaves no gap and comes back where it was.
 */

import type { Direction } from "../shared/controls/slider-math.ts";

export const TILE_SIZES = ["round", "wide", "tall", "flat"] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const isTileSize = (value: unknown): value is TileSize => TILE_SIZES.some((size) => size === value);

/** Columns and rows each size takes. */
export const SPAN: Readonly<Record<TileSize, { cols: number; rows: number }>> = {
  round: { cols: 1, rows: 1 },
  wide: { cols: 2, rows: 1 },
  tall: { cols: 1, rows: 3 },
  flat: { cols: 4, rows: 1 },
};

/** The panel's measures (docs/design.html): 344 wide, 12 in, 8 apart, rows 56. */
export const GRID = { columns: 4, width: 344, padding: 12, gap: 8, row: 56, radius: 28 } as const;

/** One column's width: (344 − 2 × 12 − 3 × 8) / 4 = 74. */
export const COLUMN = (GRID.width - 2 * GRID.padding - (GRID.columns - 1) * GRID.gap) / GRID.columns;

export interface LayoutItem {
  id: string;
  size: TileSize;
}

/** The saved layout: every control the person keeps, in order, missing ones included. */
export type Layout = readonly LayoutItem[];

export interface Placed extends LayoutItem {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/**
 * Places the items in order, each at the first cell from the top left where
 * it fits (CSS grid's dense auto-placement), so a removed tile leaves no hole
 * a later one could take.
 */
export function pack(items: readonly LayoutItem[], columns: number = GRID.columns): Placed[] {
  const taken: boolean[][] = [];
  const free = (row: number, col: number, cols: number, rows: number): boolean => {
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) if (taken[r]?.[c]) return false;
    return true;
  };
  const placed: Placed[] = [];
  for (const item of items) {
    const cols = Math.min(SPAN[item.size].cols, columns);
    const { rows } = SPAN[item.size];
    for (let row = 0; ; row++) {
      const col = Array.from({ length: columns - cols + 1 }, (_, at) => at).find((at) => free(row, at, cols, rows));
      if (col === undefined) continue;
      for (let r = row; r < row + rows; r++) {
        taken[r] ??= [];
        for (let c = col; c < col + cols; c++) (taken[r] as boolean[])[c] = true;
      }
      placed.push({ ...item, col, row, cols, rows });
      break;
    }
  }
  return placed;
}

/** Rows the placed tiles take. */
export const rowCount = (placed: readonly Placed[]): number => Math.max(0, ...placed.map((tile) => tile.row + tile.rows));

/** The grid's height in points. */
export const gridHeight = (placed: readonly Placed[]): number => {
  const rows = rowCount(placed);
  return rows === 0 ? 0 : rows * GRID.row + (rows - 1) * GRID.gap;
};

/** Where a placed tile is drawn, in points from the grid's top left. */
export function frameOf(tile: Pick<Placed, "col" | "row" | "cols" | "rows">): { left: number; top: number; width: number; height: number } {
  return {
    left: tile.col * (COLUMN + GRID.gap),
    top: tile.row * (GRID.row + GRID.gap),
    width: tile.cols * COLUMN + (tile.cols - 1) * GRID.gap,
    height: tile.rows * GRID.row + (tile.rows - 1) * GRID.gap,
  };
}

/** The items that are shown: the ones whose control is there. */
export const shown = (layout: Layout, isThere: (id: string) => boolean): LayoutItem[] => layout.filter((item) => isThere(item.id));

/** Without `id`; the rest close up. */
export const removeItem = (layout: Layout, id: string): Layout => layout.filter((item) => item.id !== id);

/** `id` added at the end, in `size`; one already there stays as it is. */
export const addItem = (layout: Layout, id: string, size: TileSize): Layout => (layout.some((item) => item.id === id) ? layout : [...layout, { id, size }]);

/** `id` in its next size of `sizes` (round ↔ wide, tall ↔ flat); a control with one size keeps it. */
export function nextSize(layout: Layout, id: string, sizes: readonly TileSize[]): Layout {
  return layout.map((item) => {
    if (item.id !== id || sizes.length < 2) return item;
    const at = sizes.indexOf(item.size);
    return { ...item, size: sizes[(at + 1) % sizes.length] as TileSize };
  });
}

/**
 * `id` moved to where `before` is (the shown item it lands on): before it
 * when coming from later in the order, after it when coming from earlier, so
 * a drag over the next tile swaps the two. Hidden items keep their places.
 */
export function moveItem(layout: Layout, id: string, before: string): Layout {
  if (id === before) return layout;
  const from = layout.findIndex((item) => item.id === id);
  const to = layout.findIndex((item) => item.id === before);
  if (from < 0 || to < 0) return layout;
  const moving = layout[from] as LayoutItem;
  const rest = layout.filter((_, at) => at !== from);
  const target = rest.findIndex((item) => item.id === before);
  const at = from < to ? target + 1 : target;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * The tile the arrow keys go to from `from`: the nearest one whose frame
 * lies that way, nearest along the arrow first, then across it. Null at the
 * grid's edge.
 */
export function neighbor(placed: readonly Placed[], from: string, direction: Direction): string | null {
  const start = placed.find((tile) => tile.id === from);
  if (!start) return placed[0]?.id ?? null;
  const center = (tile: Placed) => ({ x: tile.col + tile.cols / 2, y: tile.row + tile.rows / 2 });
  const here = center(start);
  const ahead = (tile: Placed): number => {
    switch (direction) {
      case "left":
        return start.col - (tile.col + tile.cols) + 1;
      case "right":
        return tile.col - (start.col + start.cols) + 1;
      case "up":
        return start.row - (tile.row + tile.rows) + 1;
      case "down":
        return tile.row - (start.row + start.rows) + 1;
    }
  };
  const across = (tile: Placed): number => {
    const there = center(tile);
    return direction === "left" || direction === "right" ? Math.abs(there.y - here.y) : Math.abs(there.x - here.x);
  };
  // Overlapping the start along the other axis comes first: ↓ from a wide tile goes to what is under it.
  const overlaps = (tile: Placed): boolean =>
    direction === "left" || direction === "right"
      ? tile.row < start.row + start.rows && start.row < tile.row + tile.rows
      : tile.col < start.col + start.cols && start.col < tile.col + tile.cols;
  const candidates = placed.filter((tile) => tile.id !== from && ahead(tile) > 0);
  candidates.sort((a, b) => Number(overlaps(b)) - Number(overlaps(a)) || ahead(a) - ahead(b) || across(a) - across(b) || a.row - b.row || a.col - b.col);
  return candidates[0]?.id ?? null;
}

/**
 * ⌥ and an arrow in edit mode: `id` trades places with its neighbor that
 * way, so the grid packs it there.
 */
export function moveToward(layout: Layout, placed: readonly Placed[], id: string, direction: Direction): Layout {
  const other = neighbor(placed, id, direction);
  if (other === null) return layout;
  const from = layout.findIndex((item) => item.id === id);
  const to = layout.findIndex((item) => item.id === other);
  const next = [...layout];
  next[from] = layout[to] as LayoutItem;
  next[to] = layout[from] as LayoutItem;
  return next;
}

/** The shown tile under a point of the grid (points from its top left), or null between tiles. */
export function tileAt(placed: readonly Placed[], x: number, y: number): string | null {
  const hit = placed.find((tile) => {
    const frame = frameOf(tile);
    return x >= frame.left && x < frame.left + frame.width && y >= frame.top && y < frame.top + frame.height;
  });
  return hit?.id ?? null;
}

/** The layout as saved: `{"items":[{"id","size"}]}`. */
export function serializeLayout(layout: Layout): string {
  return JSON.stringify({ items: layout.map(({ id, size }) => ({ id, size })) });
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,160}$/;

/** A saved layout; null for anything unreadable (the default is used). Unknown sizes and repeated ids are left out. */
export function parseLayout(value: unknown): Layout | null {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { items?: unknown }).items)) return null;
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const entry of (value as { items: unknown[] }).items) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, size } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || seen.has(id) || !isTileSize(size)) continue;
    seen.add(id);
    items.push({ id, size });
  }
  return items.slice(0, 64);
}
