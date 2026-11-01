/**
 * Where each window goes in the overview (Mission Control), as pure geometry.
 * Windows keep their shapes and one common scale, are never drawn larger than
 * they are, and are packed in rows, in the order given (the caller passes them
 * front to back, so the most recent one is first), with margins around the
 * lot and gaps between. The scale is the largest at which everything fits the
 * area; each row is centered, and so is the block.
 */

import type { Rect } from "../layout.ts";

export interface OverviewWindow {
  id: number;
  /** The window's outer frame size, title bar included. */
  width: number;
  height: number;
}

export interface Placed {
  id: number;
  rect: Rect;
}

export interface OverviewOptions {
  /** Space between the area's edges and the windows. */
  margin: number;
  /** Space between windows, across and down. */
  gap: number;
}

export const OVERVIEW_DEFAULTS: OverviewOptions = { margin: 40, gap: 24 };

/** How many halvings of the scale range the search makes: far finer than a pixel. */
const STEPS = 40;

interface Row {
  items: OverviewWindow[];
  width: number;
  height: number;
}

/** Windows laid in rows at `scale`, or null if they do not fit `width` × `height`. */
function pack(windows: readonly OverviewWindow[], scale: number, width: number, height: number, gap: number): Row[] | null {
  const rows: Row[] = [];
  let row: Row | null = null;
  for (const window of windows) {
    const w = window.width * scale;
    const h = window.height * scale;
    if (w > width) return null;
    if (row && row.width + gap + w <= width) {
      row.items.push(window);
      row.width += gap + w;
      row.height = Math.max(row.height, h);
    } else {
      row = { items: [window], width: w, height: h };
      rows.push(row);
    }
  }
  const total = rows.reduce((sum, each) => sum + each.height, 0) + gap * Math.max(0, rows.length - 1);
  return total <= height ? rows : null;
}

/** The biggest scale (at most 1) at which `windows` fit, with the rows they make then. */
function best(windows: readonly OverviewWindow[], width: number, height: number, gap: number): { scale: number; rows: Row[] } | null {
  const whole = pack(windows, 1, width, height, gap);
  if (whole) return { scale: 1, rows: whole };
  // Fitting is monotone in the scale (a smaller scale only ever helps), so halve the range.
  let low = 0;
  let high = 1;
  let found: { scale: number; rows: Row[] } | null = null;
  for (let step = 0; step < STEPS; step++) {
    const middle = (low + high) / 2;
    const rows = pack(windows, middle, width, height, gap);
    if (rows) {
      found = { scale: middle, rows };
      low = middle;
    } else {
      high = middle;
    }
  }
  return found;
}

/**
 * Rectangles for `windows` inside `area`, in the same order. Sizes that are
 * not positive are skipped. Nothing overlaps, nothing leaves the area (less its
 * margin), and nothing is larger than the window it stands for.
 */
export function layoutOverview(windows: readonly OverviewWindow[], area: Rect, options: Partial<OverviewOptions> = {}): Placed[] {
  const { margin, gap } = { ...OVERVIEW_DEFAULTS, ...options };
  const sized = windows.filter((window) => window.width > 0 && window.height > 0);
  if (sized.length === 0) return [];
  // A tiny area gives up its margin rather than leave no room at all.
  const inset = Math.min(margin, Math.floor(Math.min(area.width, area.height) / 4));
  const width = area.width - 2 * inset;
  const height = area.height - 2 * inset;
  // Too many windows for the gaps: close the gaps rather than fail.
  const attempt = (spacing: number) => {
    const found = best(sized, width, height, spacing);
    return found && { ...found, spacing };
  };
  const fit = attempt(gap) ?? attempt(0);
  if (!fit) return [];
  const { scale, rows, spacing } = fit;
  // Whole pixels, rounded down so nothing grows past what the search allowed
  // (the nudge only forgives the search stopping a hair short of a boundary).
  const whole = (length: number) => Math.max(1, Math.floor(length * scale + 1e-6));
  const shelves = rows.map((row) => {
    const items = row.items.map((window) => ({ id: window.id, width: whole(window.width), height: whole(window.height) }));
    return {
      items,
      width: items.reduce((sum, item) => sum + item.width, 0) + spacing * (items.length - 1),
      height: Math.max(...items.map((item) => item.height)),
    };
  });
  const block = shelves.reduce((sum, shelf) => sum + shelf.height, 0) + spacing * (shelves.length - 1);
  let y = area.y + inset + Math.floor((height - block) / 2);
  const placed: Placed[] = [];
  for (const shelf of shelves) {
    let x = area.x + inset + Math.floor((width - shelf.width) / 2);
    for (const item of shelf.items) {
      // Windows in a row sit on its middle line, like thumbnails on a shelf.
      placed.push({ id: item.id, rect: { x, y: y + Math.floor((shelf.height - item.height) / 2), width: item.width, height: item.height } });
      x += item.width + spacing;
    }
    y += shelf.height + spacing;
  }
  return placed;
}
