/**
 * Zoom and pan arithmetic for the picture area. A picture is shown either
 * fitted to the window or at a chosen scale (logical pixels per picture
 * pixel; for a PDF page, per point). The pan is how far the picture's centre
 * sits from the area's centre, and it only exists once the picture is larger
 * than the area on that axis.
 */

import type { Size } from "./dimensions.ts";

export type ZoomMode = { kind: "fit" } | { kind: "scale"; scale: number };

export interface Pan {
  x: number;
  y: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;
/** The scales the zoom buttons step through. */
export const STEPS: readonly number[] = [0.02, 0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export const FIT: ZoomMode = { kind: "fit" };

/** The room a picture keeps around it when fitted: a PDF's page margin (layout.ts), so it never touches the toolbar or the window's edge. */
export const FIT_MARGIN = 16;

/** The area a fitted picture fills: `area` less FIT_MARGIN on every side (never less than a pixel). */
export const fitArea = (area: Size): Size =>
  area.width <= 0 || area.height <= 0 ? area : { width: Math.max(1, area.width - FIT_MARGIN * 2), height: Math.max(1, area.height - FIT_MARGIN * 2) };

/** The scale that fits `content` inside `area`; a small picture is not blown up past its own size unless `upscale`. */
export function fitScale(content: Size, area: Size, upscale = false): number {
  if (content.width <= 0 || content.height <= 0 || area.width <= 0 || area.height <= 0) return 1;
  const fit = Math.min(area.width / content.width, area.height / content.height);
  return clampScale(upscale ? fit : Math.min(fit, 1));
}

export function clampScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : 1;
}

/** The scale a mode stands for, given the fitted one. */
export const scaleOf = (mode: ZoomMode, fitted: number): number => (mode.kind === "fit" ? fitted : clampScale(mode.scale));

/** The next step above `scale`, or the top step. */
export function zoomIn(scale: number): number {
  return STEPS.find((step) => step > scale * 1.001) ?? (STEPS.at(-1) as number);
}

/** The next step below `scale`, or the bottom step. */
export function zoomOut(scale: number): number {
  return [...STEPS].reverse().find((step) => step < scale / 1.001) ?? (STEPS[0] as number);
}

/** The zoom as a label: 100%, 33%, 1,200%. */
export function percent(scale: number): string {
  const value = scale * 100;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}%`;
}

/** The picture's size on screen. */
export const scaled = (content: Size, scale: number): Size => ({ width: content.width * scale, height: content.height * scale });

/** How far the pan may go on one axis: half of what the picture overhangs the area. */
const reach = (shown: number, area: number): number => Math.max(0, (shown - area) / 2);

/** `pan` held inside what the picture allows; none on an axis where it fits. */
export function clampPan(pan: Pan, shown: Size, area: Size): Pan {
  const rx = reach(shown.width, area.width);
  const ry = reach(shown.height, area.height);
  return { x: Math.min(rx, Math.max(-rx, pan.x)) || 0, y: Math.min(ry, Math.max(-ry, pan.y)) || 0 };
}

/** The pan after the scale changes, keeping the same part of the picture in the middle. */
export function panAfterZoom(pan: Pan, from: number, to: number): Pan {
  const ratio = from > 0 ? to / from : 1;
  return { x: pan.x * ratio, y: pan.y * ratio };
}

/** Where the picture's top-left corner is inside the area. */
export function placement(shown: Size, area: Size, pan: Pan): { left: number; top: number } {
  const held = clampPan(pan, shown, area);
  return { left: (area.width - shown.width) / 2 + held.x, top: (area.height - shown.height) / 2 + held.y };
}

/** A size turned by `turns` quarter turns (an odd number swaps the sides). */
export const turned = (size: Size, turns: number): Size => (mod4(turns) % 2 === 1 ? { width: size.height, height: size.width } : size);

export function mod4(turns: number): 0 | 1 | 2 | 3 {
  return (((Math.trunc(turns) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}
