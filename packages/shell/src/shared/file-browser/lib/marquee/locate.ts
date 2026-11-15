/**
 * Where a listing's content stands in its window, asked of the window
 * (`WindowSurface.bounds`, D100): the scroll view's painted bounds, and the
 * window pixels of the content's top left, worked out from the first item
 * that is painted.
 */

import type { WindowSurface } from "../../../metal/index.ts";
import type { Point, Rect } from "./geometry.ts";
import type { ListingModel } from "./types.ts";

export interface Placed {
  /** The scroll view, in window pixels. */
  viewport: Rect;
  /** The content's top left, in window pixels: above the viewport's once it is scrolled. */
  origin: Point;
}

/** Null when the scroll view or every item is out of sight. */
export async function locate(surface: WindowSurface, model: ListingModel): Promise<Placed | null> {
  const [viewport, ...nodes] = await surface.bounds([model.scrollID, ...model.paths.map((path) => model.nodeOf(path))]);
  const index = nodes.findIndex((node) => node !== null);
  const node = nodes[index];
  const rect = model.rects[index];
  if (!viewport || !node || !rect) return null;
  return { viewport, origin: { x: node.x - rect.x, y: node.y - rect.y } };
}

/** Whether `point` (window pixels) is in the scroll view. */
export function inView(point: Point, viewport: Rect): boolean {
  return point.x >= viewport.x && point.x <= viewport.x + viewport.width && point.y >= viewport.y && point.y <= viewport.y + viewport.height;
}
