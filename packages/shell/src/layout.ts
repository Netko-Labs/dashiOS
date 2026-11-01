/**
 * Where windows go, as pure geometry (macOS conventions): new windows open
 * centered and a little high, cascading; tiles are halves and quarters of
 * the usable area with a small gap; dragging a window to a screen edge
 * aims at a half, its ends at a quarter, the menu bar at all of it.
 * arrange.ts applies these through the compositor. Every rectangle is an
 * outer frame, title bar included.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Output {
  name: string;
  /** The whole screen. */
  frame: Rect;
  /** What the menu bar and the Dock leave free. */
  usable: Rect;
  scale: number;
}

/** A drag target: the pointer in `area` aims the window at `frame`. */
export interface Zone {
  area: Rect;
  frame: Rect;
}

export const TILES = ["left", "right", "top-left", "top-right", "bottom-left", "bottom-right", "fill", "restore"] as const;
export type Tile = (typeof TILES)[number];

/** Space between tiles, and around them. */
const GAP = 6;
/** How close to a side a drag must come. */
const EDGE = 8;
/** How far from the top or bottom a side's ends (the quarters) reach. */
const CORNER = 48;
/** How far each new window steps from the last, and after how many it starts over. */
const CASCADE = { step: 28, count: 6 };

/** The frame a tile takes; `restore` has none (the window goes back to its own). */
export function tileFrame(tile: Exclude<Tile, "restore">, usable: Rect): Rect {
  const inner = { x: usable.x + GAP, y: usable.y + GAP, width: usable.width - 2 * GAP, height: usable.height - 2 * GAP };
  const halfWidth = Math.floor((inner.width - GAP) / 2);
  const halfHeight = Math.floor((inner.height - GAP) / 2);
  const right = inner.x + inner.width - halfWidth;
  const bottom = inner.y + inner.height - halfHeight;
  const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
  switch (tile) {
    case "left":
      return rect(inner.x, inner.y, halfWidth, inner.height);
    case "right":
      return rect(right, inner.y, halfWidth, inner.height);
    case "top-left":
      return rect(inner.x, inner.y, halfWidth, halfHeight);
    case "top-right":
      return rect(right, inner.y, halfWidth, halfHeight);
    case "bottom-left":
      return rect(inner.x, bottom, halfWidth, halfHeight);
    case "bottom-right":
      return rect(right, bottom, halfWidth, halfHeight);
    case "fill":
      return inner;
  }
}

/** Zoom: all of the usable area, no gap. */
export const zoomFrame = (usable: Rect): Rect => ({ ...usable });

/** Drag zones for one screen, checked in order: the sides' ends (quarters),
 * the sides (halves), then the menu bar (fill). */
export function dragZones(output: Output): Zone[] {
  const { frame: screen, usable } = output;
  const side = EDGE + 1;
  const topEnd = usable.y + CORNER + 1;
  const bottomStart = usable.y + usable.height - CORNER;
  const screenBottom = screen.y + screen.height;
  const column = (x: number) => ({
    top: { x, y: screen.y, width: side, height: topEnd - screen.y },
    middle: { x, y: topEnd, width: side, height: bottomStart - topEnd },
    bottom: { x, y: bottomStart, width: side, height: screenBottom - bottomStart },
  });
  const left = column(screen.x);
  const right = column(screen.x + screen.width - side);
  const menuBar = { x: screen.x + side, y: screen.y, width: screen.width - 2 * side, height: usable.y + 2 - screen.y };
  const zones: Array<[Rect, Exclude<Tile, "restore">]> = [
    [left.top, "top-left"],
    [left.bottom, "bottom-left"],
    [left.middle, "left"],
    [right.top, "top-right"],
    [right.bottom, "bottom-right"],
    [right.middle, "right"],
    [menuBar, "fill"],
  ];
  return zones
    .filter(([area]) => area.width > 0 && area.height > 0)
    .map(([area, tile]) => ({ area, frame: tileFrame(tile, usable) }));
}

/** Where the `count`th new window's frame goes: centered across, a third of
 * the way down (as on the Mac), each one stepping a little from the last. */
export function placeNew(size: { width: number; height: number }, usable: Rect, count: number): { x: number; y: number } {
  const offset = (count % CASCADE.count) * CASCADE.step;
  return {
    x: usable.x + Math.floor(Math.max(usable.width - size.width, 0) / 2) + offset,
    y: usable.y + Math.floor(Math.max(usable.height - size.height, 0) / 3) + offset,
  };
}

/**
 * `frame` moved and, if it must, shrunk to fit inside `usable` (after a
 * screen changed size or scale). A frame that already fits comes back as is.
 */
export function fitFrame(frame: Rect, usable: Rect): Rect {
  const width = Math.min(frame.width, usable.width);
  const height = Math.min(frame.height, usable.height);
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
  return {
    x: clamp(frame.x, usable.x, usable.x + usable.width - width),
    y: clamp(frame.y, usable.y, usable.y + usable.height - height),
    width,
    height,
  };
}

/** The usable area of the screen holding `frame`'s center (else the first screen's). */
export function usableFor(frame: Rect, screens: readonly { frame: Rect; usable: Rect }[]): Rect | null {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const holding = screens.find(({ frame: screen }) => cx >= screen.x && cx < screen.x + screen.width && cy >= screen.y && cy < screen.y + screen.height);
  return (holding ?? screens[0])?.usable ?? null;
}
