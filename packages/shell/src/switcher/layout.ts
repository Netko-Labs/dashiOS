/**
 * Where the switcher's parts go, in its surface's pixels: the panel, a cell
 * per app, the chosen app's name, and the window row under them when it
 * shows (the compositor draws each window's live picture in its rect:
 * `window-thumbnails`). The surface is sized for the biggest window row the
 * session can show (`switcherSize`), and the panel grows down into it, so
 * the app row never moves. Pure: what is drawn and where the pictures go
 * come from the same numbers.
 */

import type { Rect } from "../layout.ts";

export const ICON = 64;
export const CELL = ICON + 16;
const GAP = 12;
const PAD = 14;
/** The chosen app's name under the row. */
const NAME = 26;
/** Room around the panel for its shadow. */
const MARGIN = 24;
/** A window's picture, its title under it, and the space around. */
export const THUMB = { width: 184, height: 115, title: 20, gap: 12 } as const;

const rowWidth = (count: number, width: number, gap: number) => (count > 0 ? count * width + (count - 1) * gap : 0);
const windowRowHeight = (windows: number) => (windows > 0 ? THUMB.gap + THUMB.height + THUMB.title : 0);

/** The panel's size for `apps` apps and a window row of `windows` (0: none), shadow room included. */
export function switcherSize(apps: number, windows = 0): { width: number; height: number } {
  const inner = Math.max(rowWidth(apps, CELL, GAP), rowWidth(windows, THUMB.width, THUMB.gap));
  return { width: inner + PAD * 2 + MARGIN * 2, height: CELL + NAME + windowRowHeight(windows) + PAD * 2 + MARGIN * 2 };
}

export interface SwitcherLayout {
  panel: Rect;
  apps: Rect[];
  name: Rect;
  /** One per window shown, left to right: its picture, and its title under it. */
  windows: Rect[];
  titles: Rect[];
}

/** The parts in a surface `width` wide, for `apps` apps and `windows` windows shown (0: no window row). */
export function switcherLayout(width: number, apps: number, windows: number): SwitcherLayout {
  const appsWidth = rowWidth(apps, CELL, GAP);
  const windowsWidth = rowWidth(windows, THUMB.width, THUMB.gap);
  const inner = Math.max(appsWidth, windowsWidth);
  const panel = { x: Math.round((width - inner) / 2) - PAD, y: MARGIN, width: inner + PAD * 2, height: CELL + NAME + windowRowHeight(windows) + PAD * 2 };
  const appsLeft = Math.round((width - appsWidth) / 2);
  const top = MARGIN + PAD;
  const appRects = Array.from({ length: apps }, (_, index) => ({ x: appsLeft + index * (CELL + GAP), y: top, width: CELL, height: CELL }));
  const name = { x: panel.x, y: top + CELL, width: panel.width, height: NAME };
  const windowsLeft = Math.round((width - windowsWidth) / 2);
  const windowTop = top + CELL + NAME + THUMB.gap;
  const windowRects = Array.from({ length: windows }, (_, index) => ({
    x: windowsLeft + index * (THUMB.width + THUMB.gap),
    y: windowTop,
    width: THUMB.width,
    height: THUMB.height,
  }));
  const titles = windowRects.map((rect) => ({ x: rect.x, y: rect.y + rect.height, width: rect.width, height: THUMB.title }));
  return { panel, apps: appRects, name, windows: windowRects, titles };
}

/**
 * Where a surface `size` big sits on a screen whose usable area is
 * `usable`: layer-shell centers a surface anchored to no edge in what the
 * menu bar and the Dock leave free.
 */
export function centeredOn(usable: Rect, size: { width: number; height: number }): { x: number; y: number } {
  return { x: usable.x + Math.floor((usable.width - size.width) / 2), y: usable.y + Math.floor((usable.height - size.height) / 2) };
}
