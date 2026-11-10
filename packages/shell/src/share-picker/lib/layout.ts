/**
 * Where the share picker's parts go, in its surface's pixels: the title,
 * a live picture per screen, a live picture per window (four to a row), the
 * "Hide notifications while sharing" switch, and Cancel and Share. The
 * compositor draws the pictures in these rects (`space-previews` with
 * `screen`, `window-thumbnails`); the panel draws their frames and names.
 */

import type { Rect } from "../../layout.ts";

export const PICKER = {
  width: 720,
  pad: 20,
  title: 28,
  heading: 22,
  gap: 14,
  screen: { height: 112 },
  window: { width: 154, height: 96 },
  caption: 20,
  columns: 4,
  /** The most windows shown, most recently used first. */
  windows: 12,
  option: 28,
  buttons: 34,
} as const;

export interface PickerLayout {
  size: { width: number; height: number };
  title: Rect;
  screensHeading: Rect;
  screens: Rect[];
  windowsHeading: Rect | null;
  windows: Rect[];
  option: Rect;
  cancel: Rect;
  share: Rect;
}

/** The picker for screens shaped `aspects` (width over height, each) and `windows` windows. */
export function pickerLayout(aspects: readonly number[], windows: number): PickerLayout {
  const { width, pad, gap } = PICKER;
  const inner = width - 2 * pad;
  let y = pad;
  const title = { x: pad, y, width: inner, height: PICKER.title };
  y += PICKER.title + gap;
  const screensHeading = { x: pad, y, width: inner, height: PICKER.heading };
  y += PICKER.heading;
  // Screens side by side, each its own shape, as tall as fits.
  const shapes = aspects.map((aspect) => (Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9));
  const total = shapes.reduce((sum, shape) => sum + shape * PICKER.screen.height, 0) + gap * Math.max(0, shapes.length - 1);
  const shrink = total > inner ? (inner - gap * Math.max(0, shapes.length - 1)) / (total - gap * Math.max(0, shapes.length - 1)) : 1;
  const height = Math.floor(PICKER.screen.height * shrink);
  let x = pad;
  const screens = shapes.map((shape) => {
    const rect = { x, y, width: Math.floor(shape * height), height };
    x += rect.width + gap;
    return rect;
  });
  y += height + PICKER.caption + gap;
  const shown = Math.min(windows, PICKER.windows);
  const windowsHeading = shown > 0 ? { x: pad, y, width: inner, height: PICKER.heading } : null;
  if (windowsHeading) y += PICKER.heading;
  const step = PICKER.window.width + Math.floor((inner - PICKER.columns * PICKER.window.width) / (PICKER.columns - 1));
  const windowRects = Array.from({ length: shown }, (_, index) => ({
    x: pad + (index % PICKER.columns) * step,
    y: y + Math.floor(index / PICKER.columns) * (PICKER.window.height + PICKER.caption + gap),
    width: PICKER.window.width,
    height: PICKER.window.height,
  }));
  const rows = Math.ceil(shown / PICKER.columns);
  y += rows * (PICKER.window.height + PICKER.caption + gap);
  const option = { x: pad, y, width: inner, height: PICKER.option };
  y += PICKER.option + gap;
  const buttonWidth = 96;
  const share = { x: width - pad - buttonWidth, y, width: buttonWidth, height: PICKER.buttons };
  const cancel = { x: share.x - gap - buttonWidth, y, width: buttonWidth, height: PICKER.buttons };
  y += PICKER.buttons + pad;
  return { size: { width, height: y }, title, screensHeading, screens, windowsHeading, windows: windowRects, option, cancel, share };
}

/** The caption's place under a picture. */
export const captionOf = (rect: Rect): Rect => ({ x: rect.x, y: rect.y + rect.height, width: rect.width, height: PICKER.caption });
