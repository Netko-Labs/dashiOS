/**
 * When a live wallpaper should stand still. This is a laptop: a wallpaper
 * nobody can see, or that the battery pays for, should draw nothing. Pure
 * functions; controller.ts feeds them what the desktop reports and applies
 * the answer (SIGSTOP for a renderer, IPC `wallpaper {paused}` for the
 * compositor's own shaders).
 */

import type { CompositorWindow, Frame } from "../../compositor.ts";

export type PauseReason = "locked" | "off" | "covered" | "battery";

export interface PauseInputs {
  /** The session is locked: the lock screen shows the still wallpaper. */
  locked: boolean;
  /** The screens are blanked. */
  screensOff: boolean;
  /** Windows hide this screen's wallpaper. */
  covered: boolean;
  /** Running on battery (a machine with no battery is never on it). */
  onBattery: boolean;
  /** "Pause on battery" is chosen (it is by default). */
  pauseOnBattery: boolean;
}

/** Why the wallpaper should pause, or null when it may run; the most basic reason first. */
export function pauseReason(inputs: PauseInputs): PauseReason | null {
  if (inputs.locked) return "locked";
  if (inputs.screensOff) return "off";
  if (inputs.covered) return "covered";
  if (inputs.onBattery && inputs.pauseOnBattery) return "battery";
  return null;
}

/** A screen as far as covering goes: where it is, and the part the menu bar and Dock leave to windows. */
export interface ScreenArea {
  name: string;
  frame: Frame;
  usable: Frame;
}

/** The screens in an IPC `outputs` answer that say where they are; the usable area falls back to the whole frame. */
export function parseScreenAreas(answer: unknown): ScreenArea[] {
  const outputs = typeof answer === "object" && answer !== null ? (answer as { outputs?: unknown }).outputs : undefined;
  if (!Array.isArray(outputs)) return [];
  return outputs.flatMap((output: unknown): ScreenArea[] => {
    if (typeof output !== "object" || output === null) return [];
    const { name, frame, usable } = output as Record<string, unknown>;
    const whole = asFrame(frame);
    if (typeof name !== "string" || whole === null) return [];
    return [{ name, frame: whole, usable: asFrame(usable) ?? whole }];
  });
}

function asFrame(value: unknown): Frame | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return width as number > 0 && (height as number) > 0 ? ({ x, y, width, height } as Frame) : null;
}

/** How much of the usable area windows must hide before the wallpaper counts as hidden. */
export const COVERED_FRACTION = 0.97;

/**
 * Whether the windows hide `screen`'s wallpaper: one is full screen there,
 * or the windows on it together (a zoomed one, or tiles side by side) leave
 * almost none of the usable area uncovered. A minimized or hidden window
 * covers nothing.
 */
export function isCovered(screen: ScreenArea, windows: readonly Pick<CompositorWindow, "state" | "frame" | "fullscreen">[]): boolean {
  const shown = windows.filter((window) => window.state === "normal" && window.frame !== null);
  const rects = shown.flatMap((window) => (window.frame ? [window.frame] : []));
  const full = shown.some((window) => window.fullscreen === true && window.frame !== null && overlap(window.frame, screen.frame) >= area(screen.frame) * COVERED_FRACTION);
  if (full) return true;
  const total = area(screen.usable);
  return total > 0 && unionArea(rects.map((rect) => clip(rect, screen.usable))) >= total * COVERED_FRACTION;
}

const area = (frame: Frame): number => frame.width * frame.height;

function clip(rect: Frame, to: Frame): Frame {
  const x = Math.max(rect.x, to.x);
  const y = Math.max(rect.y, to.y);
  const right = Math.min(rect.x + rect.width, to.x + to.width);
  const bottom = Math.min(rect.y + rect.height, to.y + to.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

const overlap = (a: Frame, b: Frame): number => area(clip(a, b));

/** The area covered by at least one rectangle: a sweep over the x edges. */
function unionArea(rects: readonly Frame[]): number {
  const live = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  const xs = [...new Set(live.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const left = xs[i] as number;
    const right = xs[i + 1] as number;
    const spans = live
      .filter((rect) => rect.x <= left && rect.x + rect.width >= right)
      .map((rect): [number, number] => [rect.y, rect.y + rect.height])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = -Infinity;
    for (const [top, bottom] of spans) {
      const from = Math.max(top, end);
      if (bottom > from) covered += bottom - from;
      end = Math.max(end, bottom);
    }
    total += covered * (right - left);
  }
  return total;
}
