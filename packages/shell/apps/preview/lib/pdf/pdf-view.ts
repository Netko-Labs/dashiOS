/**
 * How a PDF's zoom and scroll become positions: the scale a zoom stands for,
 * the scroll that keeps the middle of the screen in place through a zoom, and
 * the point of a page under a place on the surface (back through the turn).
 * Pure; use-pdf-scroll.ts holds the state these run on.
 */

import type { Size } from "../dimensions.ts";
import { anchorAt, anchorY, clampScroll, fitPageScale, fitWidthScale, type Layout, MARGIN } from "../layout.ts";
import { unturnPoint } from "../text.ts";
import { clampScale, turned } from "../zoom.ts";

/** A PDF's "100%" is the screen's 96 dpi: a point is 4/3 of a logical pixel. */
export const PDF_UNIT = 96 / 72;

export type DocZoom = { kind: "width" } | { kind: "fit" } | { kind: "scale"; scale: number };

export interface Scroll {
  x: number;
  y: number;
}

/** A point on a page, in its points as poppler measures it (before Preview's rotation). */
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

/** The scale a zoom stands for in an area. */
export function scaleFor(zoom: DocZoom, sizes: readonly Size[], area: Size): number {
  if (zoom.kind === "width") return clampScale(fitWidthScale(sizes, area.width));
  if (zoom.kind === "fit") return clampScale(fitPageScale(sizes, area));
  return clampScale(zoom.scale);
}

/** The scroll that keeps the middle of the screen on the same point, from `was` to the layout `after` a zoom makes. */
export function scrollAfterZoom(was: { layout: Layout; scroll: Scroll; area: Size }, after: Layout): Scroll {
  // The point in the middle of the screen stays there.
  const anchor = anchorAt(was.layout.boxes, was.scroll.y + was.area.height / 2);
  const y = anchorY(after.boxes, anchor) - was.area.height / 2;
  const x = was.layout.width > 0 ? ((was.scroll.x + was.area.width / 2) * after.width) / was.layout.width - was.area.width / 2 : 0;
  return { x: clampScroll(x, after.width, was.area.width), y: clampScroll(y, after.height, was.area.height) };
}

/** The point under (x, y) on the surface, on the page there, or null between pages; back through the turn onto the page as poppler measures it. */
export function pagePointAt(
  x: number,
  y: number,
  was: { scroll: Scroll; layout: Layout; sizes: readonly Size[]; scale: number },
  turns: number,
): PagePoint | null {
  const cx = x + was.scroll.x;
  const cy = y + was.scroll.y;
  const box = was.layout.boxes.find((each) => cy >= each.top - MARGIN / 2 && cy <= each.top + each.height + MARGIN / 2);
  if (!box) return null;
  const shown = was.sizes[box.page - 1];
  if (!shown) return null;
  const px = Math.min(Math.max((cx - box.left) / was.scale, 0), shown.width);
  const py = Math.min(Math.max((cy - box.top) / was.scale, 0), shown.height);
  // Back through Preview's rotation, onto the page as poppler measures it.
  const plain = turned(shown, turns);
  const point = unturnPoint(px, py, plain, turns);
  return { page: box.page, x: point.x, y: point.y };
}
