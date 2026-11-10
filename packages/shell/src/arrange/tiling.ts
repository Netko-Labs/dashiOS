/**
 * What the ⌃❖ arrows do, as pure logic (docs/design.html, Window
 * management): an arrow is the half on that side; from a half, an arrow at
 * right angles makes that quarter, the opposite arrow gives the window its
 * own size back, and the same arrow again sends it to the next screen that
 * way (the same half there). From a quarter an arrow moves it to the
 * neighbouring quarter, or past the screen's edge to the next screen.
 * arrange.ts carries the steps out.
 */

import type { Rect, Tile } from "../layout.ts";

export type Arrow = "left" | "right" | "up" | "down";
export const ARROWS: readonly Arrow[] = ["left", "right", "up", "down"];

/** What an arrow does: a tile on this screen, the window's own frame back, or a tile on the next screen that way. */
export type ArrowStep = { kind: "tile"; tile: Tile } | { kind: "restore" } | { kind: "next-screen"; tile: Tile };

type Side = "left" | "right" | "top" | "bottom";
const SIDE: Record<Arrow, Side> = { left: "left", right: "right", up: "top", down: "bottom" };
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
const isAcross = (side: Side): side is "left" | "right" => side === "left" || side === "right";

/** A quarter's two sides, or null for anything else. */
function quarterSides(tile: Tile): { vertical: "top" | "bottom"; across: "left" | "right" } | null {
  switch (tile) {
    case "top-left":
      return { vertical: "top", across: "left" };
    case "top-right":
      return { vertical: "top", across: "right" };
    case "bottom-left":
      return { vertical: "bottom", across: "left" };
    case "bottom-right":
      return { vertical: "bottom", across: "right" };
    default:
      return null;
  }
}

const quarter = (vertical: "top" | "bottom", across: "left" | "right"): Tile => `${vertical}-${across}`;

/** What `arrow` does to a window arranged as `current` (null: at its own frame). */
export function arrowStep(current: Tile | null, arrow: Arrow): ArrowStep {
  const side = SIDE[arrow];
  if (current === null || current === "fill") return { kind: "tile", tile: side };
  const corner = quarterSides(current);
  if (corner) {
    if (isAcross(side)) return side === corner.across ? { kind: "next-screen", tile: current } : { kind: "tile", tile: quarter(corner.vertical, side) };
    return side === corner.vertical ? { kind: "next-screen", tile: current } : { kind: "tile", tile: quarter(side, corner.across) };
  }
  // A half.
  const half = current as Side;
  if (side === half) return { kind: "next-screen", tile: half };
  if (side === OPPOSITE[half]) return { kind: "restore" };
  return isAcross(half) ? { kind: "tile", tile: quarter(side as "top" | "bottom", half) } : { kind: "tile", tile: quarter(half, side as "left" | "right") };
}

/**
 * The next screen from `from` toward `arrow`: of the screens wholly on that
 * side of it, the one whose center is nearest; null when there is none (one
 * screen, or `from` is the last that way).
 */
export function screenToward<S extends { frame: Rect }>(from: Rect, screens: readonly S[], arrow: Arrow): S | null {
  const beyond = (screen: Rect): boolean => {
    switch (arrow) {
      case "left":
        return screen.x + screen.width <= from.x;
      case "right":
        return screen.x >= from.x + from.width;
      case "up":
        return screen.y + screen.height <= from.y;
      case "down":
        return screen.y >= from.y + from.height;
    }
  };
  const center = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  const origin = center(from);
  const distance = (screen: S) => Math.hypot(center(screen.frame).x - origin.x, center(screen.frame).y - origin.y);
  const candidates = screens.filter((screen) => beyond(screen.frame));
  return candidates.reduce<S | null>((nearest, screen) => (nearest === null || distance(screen) < distance(nearest) ? screen : nearest), null);
}
