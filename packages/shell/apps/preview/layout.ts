/**
 * A PDF as one scrolling surface: its pages stacked in a column, each at its
 * own size, centred, with a gap between them. Pure: the surface (document.tsx)
 * lays the pages out at the zoom, scrolls, and asks which pages are near the
 * screen, so only those are drawn and rendered.
 *
 * Sizes are in points (1/72 inch) as the page is shown, rotation applied;
 * the zoom is logical pixels per point; the layout is in logical pixels.
 */

import type { Size } from "./dimensions.ts";

/** Room around the column and between pages. */
export const MARGIN = 16;
export const PAGE_GAP = 12;
/** How far past the screen pages are still drawn (and rendered ahead), in screens. */
export const OVERSCAN = 0.75;

export interface PageBox {
  /** 1-based. */
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Layout {
  boxes: PageBox[];
  /** The column's size with its margins: what scrolls. */
  width: number;
  height: number;
}

/** The pages at `scale`, in a column at least `areaWidth` wide. */
export function layoutPages(sizes: readonly Size[], scale: number, areaWidth: number): Layout {
  const widest = sizes.reduce((most, size) => Math.max(most, size.width * scale), 0);
  const width = Math.max(areaWidth, widest + MARGIN * 2);
  const boxes: PageBox[] = [];
  let top = MARGIN;
  sizes.forEach((size, index) => {
    const w = size.width * scale;
    const h = size.height * scale;
    boxes.push({ page: index + 1, left: (width - w) / 2, top, width: w, height: h });
    top += h + PAGE_GAP;
  });
  return { boxes, width, height: sizes.length === 0 ? 0 : top - PAGE_GAP + MARGIN };
}

/** The zoom that fits the widest page to the area's width. */
export function fitWidthScale(sizes: readonly Size[], areaWidth: number): number {
  const widest = sizes.reduce((most, size) => Math.max(most, size.width), 0);
  return widest > 0 && areaWidth > MARGIN * 2 ? (areaWidth - MARGIN * 2) / widest : 1;
}

/** The zoom that shows one page whole (the largest page, so every page fits). */
export function fitPageScale(sizes: readonly Size[], area: Size): number {
  const widest = sizes.reduce((most, size) => Math.max(most, size.width), 0);
  const tallest = sizes.reduce((most, size) => Math.max(most, size.height), 0);
  if (widest <= 0 || tallest <= 0 || area.width <= MARGIN * 2 || area.height <= MARGIN * 2) return 1;
  return Math.min((area.width - MARGIN * 2) / widest, (area.height - MARGIN * 2) / tallest);
}

/** The index of the first box whose bottom is below `y` (binary search; the boxes run down the column). */
function firstBelow(boxes: readonly PageBox[], y: number): number {
  let low = 0;
  let high = boxes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const box = boxes[middle] as PageBox;
    if (box.top + box.height <= y) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The pages any part of which is between `top` and `top + height`, widened by `overscan` screens either side. */
export function visiblePages(boxes: readonly PageBox[], top: number, height: number, overscan = 0): number[] {
  const from = top - height * overscan;
  const to = top + height * (1 + overscan);
  const pages: number[] = [];
  for (let index = firstBelow(boxes, from); index < boxes.length; index++) {
    const box = boxes[index] as PageBox;
    if (box.top >= to) break;
    pages.push(box.page);
  }
  return pages;
}

/** The page the reader is on: the one under the middle of the screen, else the nearest. */
export function currentPage(boxes: readonly PageBox[], top: number, height: number): number {
  if (boxes.length === 0) return 1;
  const middle = top + height / 2;
  const index = Math.min(firstBelow(boxes, middle), boxes.length - 1);
  const box = boxes[index] as PageBox;
  // In the gap above this page: the page before it is nearer when its bottom is.
  const before = boxes[index - 1];
  if (before && middle < box.top && middle - (before.top + before.height) < box.top - middle) return before.page;
  return box.page;
}

/** The scroll held to what there is to scroll. */
export const clampScroll = (scroll: number, content: number, view: number): number => Math.max(0, Math.min(scroll, Math.max(0, content - view))) || 0;

/** Where the screen stands, in a form that outlives a zoom: a page, and how far down it (0 at its top, 1 at its bottom). */
export interface Anchor {
  page: number;
  fraction: number;
}

/** The anchor at `y` (the top of the screen, or the point a zoom keeps still). */
export function anchorAt(boxes: readonly PageBox[], y: number): Anchor {
  if (boxes.length === 0) return { page: 1, fraction: 0 };
  const box = boxes[Math.min(firstBelow(boxes, y), boxes.length - 1)] as PageBox;
  return { page: box.page, fraction: box.height > 0 ? (y - box.top) / box.height : 0 };
}

/** The y an anchor stands for in a layout. */
export function anchorY(boxes: readonly PageBox[], anchor: Anchor): number {
  const box = boxes[anchor.page - 1];
  return box ? box.top + box.height * anchor.fraction : 0;
}

/** The scroll that puts a page's top a margin under the screen's top. */
export function scrollToPage(boxes: readonly PageBox[], page: number): number {
  const box = boxes[Math.min(Math.max(page, 1), boxes.length) - 1];
  return box ? box.top - MARGIN : 0;
}
