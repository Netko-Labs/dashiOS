/**
 * The Desktops row opened (Mission Control, with the pointer or a dragged
 * window at the top): a live picture of each Desktop with its name under
 * it, and the + at the right end. Pure geometry in the row's own pixels,
 * shared by what is drawn (row.tsx), where the compositor draws the
 * pictures (start.tsx, `space-previews`), and what a drop lands on.
 */

import { MAX_SPACES, type Rect, ROW, type RowLayout, rowLayout } from "./model.ts";

/** The opened row: pictures this high (at most), the name under each, and its margins. */
export const SHELF = { picture: 112, top: 14, below: 6, label: 26, bottom: 12, gap: 18, lift: 6 } as const;

/** How tall the opened row is: the closed row's surface is this tall too, mostly empty. */
export const SHELF_HEIGHT = SHELF.top + SHELF.picture + SHELF.below + SHELF.label + SHELF.bottom;

export interface ShelfLayout {
  /** One per Desktop, left to right: where its picture goes. */
  pictures: Rect[];
  /** Its name, under the picture. */
  labels: Rect[];
  /** The + that adds one; null at the limit. */
  add: Rect | null;
}

/**
 * The opened row `width` wide for `count` Desktops of a screen shaped
 * `aspect` (width over height): pictures of the screen's shape, as tall as
 * SHELF allows, narrower when many don't fit; centered, the + at the right end.
 */
export function shelfLayout(width: number, count: number, aspect: number): ShelfLayout {
  const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const room = Math.max(0, width - 2 * (ROW.edge + ROW.add + SHELF.gap));
  const fits = (room - SHELF.gap * (count - 1)) / Math.max(1, count);
  const pictureWidth = Math.max(24, Math.min(Math.round(SHELF.picture * shape), Math.floor(fits)));
  const pictureHeight = Math.max(14, Math.round(pictureWidth / shape));
  const total = count * pictureWidth + (count - 1) * SHELF.gap;
  const left = Math.round((width - total) / 2);
  // Shorter pictures sit on the same line as the tallest would, their names under them.
  const top = SHELF.top + (SHELF.picture - Math.min(SHELF.picture, pictureHeight));
  const pictures = Array.from({ length: count }, (_, index) => ({
    x: left + index * (pictureWidth + SHELF.gap),
    y: top,
    width: pictureWidth,
    height: pictureHeight,
  }));
  const labels = pictures.map((picture) => ({ x: picture.x, y: picture.y + picture.height + SHELF.below, width: picture.width, height: SHELF.label }));
  const add = count < MAX_SPACES ? { x: width - ROW.edge - ROW.add, y: top, width: ROW.add, height: pictureHeight } : null;
  return { pictures, labels, add };
}

/** A picture lifted under a dragged window: a little larger and higher. */
export function lifted(rect: Rect): Rect {
  return { x: rect.x - SHELF.lift, y: rect.y - 2 * SHELF.lift, width: rect.width + 2 * SHELF.lift, height: rect.height + 2 * SHELF.lift };
}

const inside = (rect: Rect, x: number, y: number) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
const grown = (rect: Rect, slack: number): Rect => ({ x: rect.x - slack, y: rect.y - slack, width: rect.width + 2 * slack, height: rect.height + 2 * slack });

export type RowTarget = { kind: "space"; index: number } | { kind: "add" } | null;

/** What a drop at (x, y) in the row lands on: a picture or its name, or the +; forgiving by `slack`. */
export function shelfTarget(layout: ShelfLayout, x: number, y: number, slack = 8): RowTarget {
  const index = layout.pictures.findIndex((picture, at) => {
    const label = layout.labels[at];
    return inside(grown(picture, slack), x, y) || (label !== undefined && inside(grown(label, slack), x, y));
  });
  if (index >= 0) return { kind: "space", index };
  return layout.add && inside(grown(layout.add, slack), x, y) ? { kind: "add" } : null;
}

/** The Desktop whose picture or name is at (x, y), for the one a dragged window is over. */
export function shelfSpaceAt(layout: ShelfLayout, x: number, y: number): number | null {
  const target = shelfTarget(layout, x, y, 0);
  return target?.kind === "space" ? target.index : null;
}

/** The row as drawn now: opened, or one line of names (model.ts). */
export type RowShape = { open: true; layout: ShelfLayout } | { open: false; layout: RowLayout };

export function rowShape(open: boolean, width: number, count: number, aspect: number): RowShape {
  return open ? { open, layout: shelfLayout(width, count, aspect) } : { open, layout: rowLayout(width, count) };
}
