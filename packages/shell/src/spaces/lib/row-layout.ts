/**
 * Where the overview's Spaces row puts its labels, in the row's own pixels. Pure, so it is
 * tested without a compositor.
 */

import { MAX_SPACES } from "../model.ts";

/** A rectangle in the row's own pixels, or the screen's. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The Spaces row in the overview: its height, and the labels' size and spacing. */
export const ROW = { height: 64, label: { width: 132, height: 34 }, gap: 14, add: 34, edge: 20 } as const;

export interface RowLayout {
  /** One per Space, left to right. */
  labels: Rect[];
  /** The + that adds a Space; null when there are as many as can be. */
  add: Rect | null;
}

/**
 * Where the labels and the + go in a row `width` wide: the labels centered
 * (narrowed, down to a third of their width, when many don't fit), the + at
 * the right end, as on a Mac.
 */
export function rowLayout(width: number, count: number): RowLayout {
  const top = (ROW.height - ROW.label.height) / 2;
  const add = count < MAX_SPACES ? { x: width - ROW.edge - ROW.add, y: (ROW.height - ROW.add) / 2, width: ROW.add, height: ROW.add } : null;
  const room = Math.max(0, width - 2 * (ROW.edge + ROW.add + ROW.gap));
  const fits = (room - ROW.gap * (count - 1)) / count;
  const labelWidth = Math.max(Math.round(ROW.label.width / 3), Math.min(ROW.label.width, Math.floor(fits)));
  const total = count * labelWidth + (count - 1) * ROW.gap;
  const left = Math.round((width - total) / 2);
  const labels = Array.from({ length: count }, (_, index) => ({
    x: left + index * (labelWidth + ROW.gap),
    y: top,
    width: labelWidth,
    height: ROW.label.height,
  }));
  return { labels, add };
}

const inside = (rect: Rect, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

/** What is at (x, y) in a row of `layout`, a little forgiving round each target (for a drop). */
export function rowTarget(layout: RowLayout, x: number, y: number, slack = 8): { kind: "space"; index: number } | { kind: "add" } | null {
  const grow = (rect: Rect): Rect => ({ x: rect.x - slack, y: rect.y - slack, width: rect.width + 2 * slack, height: rect.height + 2 * slack });
  const index = layout.labels.findIndex((rect) => inside(grow(rect), x, y));
  if (index >= 0) return { kind: "space", index };
  return layout.add && inside(grow(layout.add), x, y) ? { kind: "add" } : null;
}

/** The row's place on a screen whose usable area (below the menu bar) is `usable`, in global pixels. */
export const rowFrame = (usable: Rect): Rect => ({ x: usable.x, y: usable.y, width: usable.width, height: ROW.height });
