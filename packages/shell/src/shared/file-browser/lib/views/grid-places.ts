/**
 * The icon view's measures, and where its items are: a cell for each, in
 * rows that fill the width, and in the cell the two parts that are the
 * item, as in the Finder: the icon and the name, at the name's own width
 * (D111). A press on either drags the file; the rest of the cell is empty
 * space to a press (a marquee starts there), and a marquee takes the item
 * when it touches either part. Files dropped anywhere on a folder's cell go
 * into it. Pure.
 */

import { textWidth, tileName } from "../../tile-name.ts";
import type { Rect } from "../marquee/geometry.ts";

export const TILE_WIDTH = 104;
export const TILE_HEIGHT = 98;
/** Search results and Recents show where each item is, one line more. */
export const TALL_TILE_HEIGHT = 114;
export const PICTURE = 56;
/** The picture starts this far under the cell's top, and the name this far under the picture. */
export const PICTURE_TOP = 6;
export const NAME_GAP = 4;
export const ROW_GAP = 4;
export const PADDING = 10;
/** The widest a name's box is: the cell less 5 each side. */
export const NAME_BOX = TILE_WIDTH - 10;
/** A name's box is this much wider than its words, and this much taller. */
export const NAME_PAD_X = 5;
export const NAME_PAD_Y = 1;
export const NAME_LINE = 15;
/** The room a name has on each of its two lines under a tile, in ems of its 12 px type: 84 px. */
export const NAME_ROOM = (TILE_WIDTH - 20) / 12;
/** A name's two lines (15 each) and its 1 px above and below: a search result's path sits under them, at one height in a row. */
export const NAME_HEIGHT = 2 * NAME_LINE + 2 * NAME_PAD_Y;

/** How many tiles fit across `width`. */
export const columnsFor = (width: number): number => Math.max(1, Math.floor((width - 2 * PADDING) / TILE_WIDTH));

/** The grid's side inset at `width`: the padding, and half of what the whole tiles leave, so the rows sit in the middle. */
export const gridInset = (width: number): number =>
  width <= 0 ? PADDING : PADDING + Math.max(0, Math.floor((width - 2 * PADDING - columnsFor(width) * TILE_WIDTH) / 2));

/** Where each of `count` cells is, in the pixels of what scrolls (the rows' column, its padding included), `height` tall, at `width`. */
export function tileRects(count: number, width: number, height: number): Rect[] {
  const columns = columnsFor(width);
  const inset = gridInset(width);
  return Array.from({ length: count }, (_, at) => ({
    x: inset + (at % columns) * TILE_WIDTH,
    y: PADDING + Math.floor(at / columns) * (height + ROW_GAP),
    width: TILE_WIDTH,
    height,
  }));
}

/** How tall `count` tiles are with their padding: what the rows' column scrolls over. */
export function gridHeight(count: number, width: number, height: number): number {
  const rows = Math.ceil(count / columnsFor(width));
  return 2 * PADDING + rows * height + Math.max(0, rows - 1) * ROW_GAP;
}

/**
 * The item in the cell `cell`: its picture, and its name's box under it, in
 * the middle, as wide as its longest line (estimated: tile-name.ts, a
 * little over). `tall` cells (search results) keep two lines for every name.
 */
export function itemParts(name: string, cell: Rect, tall = false): Rect[] {
  const lines = tileName(name, NAME_ROOM).split("\n");
  const words = Math.ceil(Math.max(...lines.map((line) => textWidth(line))) * 12);
  const width = Math.min(NAME_BOX, words + 2 * NAME_PAD_X);
  const top = cell.y + PICTURE_TOP;
  return [
    { x: cell.x + (TILE_WIDTH - PICTURE) / 2, y: top, width: PICTURE, height: PICTURE },
    {
      x: cell.x + (TILE_WIDTH - width) / 2,
      y: top + PICTURE + NAME_GAP,
      width,
      height: tall ? NAME_HEIGHT : lines.length * NAME_LINE + 2 * NAME_PAD_Y,
    },
  ];
}
