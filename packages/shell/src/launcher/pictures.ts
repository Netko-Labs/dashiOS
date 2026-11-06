/**
 * Live window pictures in the launcher (docs/betterments.html, Answers in the
 * row, C): → on a row with windows (a running app, a window) grows the row in
 * place to show them, drawn live by the compositor (`window-thumbnails`); ←
 * and → pick one, Enter switches to it, ← past the first, Esc, or moving to
 * another row folds them. Only the open row's pictures are drawn, at most
 * `STRIP.shown` at once, and only the ones on screen; the compositor blanks
 * a picture whole when an agent's capture mask covers its window. The rects
 * are sent again only when they change. Pure: the panel (window-strip.tsx)
 * draws the frames, and main.tsx puts the rects on the screen.
 */

import type { LauncherWindow } from "./items.ts";
import { windowsOf } from "./items.ts";
import type { Row } from "./row-model.ts";
import { keepInView } from "./selection.ts";

/** A picture's frame (16:10), the gap between frames, and the strip's height with its padding. */
export const STRIP = { width: 112, height: 70, gap: 8, padTop: 4, padBottom: 8, shown: 4, inset: 3 } as const;
export const STRIP_HEIGHT = STRIP.padTop + STRIP.height + STRIP.padBottom;

/** The pictures the launcher shows: which row they open under, and which window is picked. */
export interface Pictures {
  rowId: string;
  at: number;
}

/** What → and ← should do now (launcher/keys.ts binds them only then): nothing, open the pictures, or move through them. */
export type ArrowsWanted = "none" | "open" | "browse";

/** The windows a row stands for: a window row its window, an app's row its app's windows. */
export function rowWindows(row: Row | undefined, windows: readonly LauncherWindow[]): LauncherWindow[] {
  if (!row) return [];
  if (row.item?.window) return [row.item.window];
  if (row.action.kind === "focus" && row.group === "window") return [row.action.window];
  const entry = row.item?.entry ?? (row.action.kind === "open" ? row.action.entry : undefined);
  return entry ? windowsOf(windows, entry.id) : [];
}

/** The pictures still showing for `selected`: none once the selection is on another row or the row has no windows. */
export function openPictures(pictures: Pictures | null, selected: string | null, count: number): Pictures | null {
  if (!pictures || pictures.rowId !== selected || count === 0) return null;
  return { rowId: pictures.rowId, at: Math.min(Math.max(pictures.at, 0), count - 1) };
}

export function arrowsWanted(open: Pictures | null, selectedHasWindows: boolean): ArrowsWanted {
  if (open) return "browse";
  return selectedHasWindows ? "open" : "none";
}

/** ← and →: a step through the pictures; null when ← goes past the first (they fold). */
export function stepPictures(open: Pictures, count: number, by: 1 | -1): Pictures | null {
  const at = open.at + by;
  if (at < 0) return null;
  return { rowId: open.rowId, at: Math.min(at, count - 1) };
}

/** The first picture drawn, keeping the picked one in view as little moved as can be. */
export function firstShown(at: number, offset: number, count: number): number {
  return keepInView(at, offset, STRIP.shown, count);
}

/** A window's picture, surface-local: its frame's painted bounds, inset so the frame shows round it. */
export interface PictureRect {
  window: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pictureRect(window: number, frame: { x: number; y: number; width: number; height: number }): PictureRect | null {
  const w = Math.round(frame.width) - STRIP.inset * 2;
  const h = Math.round(frame.height) - STRIP.inset * 2;
  if (w <= 0 || h <= 0) return null;
  return { window, x: Math.round(frame.x) + STRIP.inset, y: Math.round(frame.y) + STRIP.inset, w, h };
}

/** The rects to send for the windows shown, once every frame has been laid out; null while one is still coming. */
export function picturesToSend(
  shown: readonly number[],
  frames: ReadonlyMap<number, { x: number; y: number; width: number; height: number }>,
): PictureRect[] | null {
  const rects: PictureRect[] = [];
  for (const window of shown) {
    const frame = frames.get(window);
    if (!frame) return null;
    const rect = pictureRect(window, frame);
    if (rect) rects.push(rect);
  }
  return rects;
}

/** The same rects as before (nothing to send): the cache. */
export function sameRects(a: readonly PictureRect[] | null, b: readonly PictureRect[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((rect, index) => {
    const other = b[index];
    return other !== undefined && rect.window === other.window && rect.x === other.x && rect.y === other.y && rect.w === other.w && rect.h === other.h;
  });
}

/** Rects in the surface's pixels on a screen: the launcher's surface is anchored to the top of the usable area, centered, 120 down. */
export function picturesOnScreen(rects: readonly PictureRect[], origin: { x: number; y: number }): PictureRect[] {
  return rects.map((rect) => ({ ...rect, x: rect.x + origin.x, y: rect.y + origin.y }));
}

/** Where the launcher's surface sits in a usable area (layer-shell: anchored top, centered across, `top` down). */
export function launcherOrigin(usable: { x: number; y: number; width: number }, width: number, top: number): { x: number; y: number } {
  return { x: usable.x + Math.floor((usable.width - width) / 2), y: usable.y + top };
}
