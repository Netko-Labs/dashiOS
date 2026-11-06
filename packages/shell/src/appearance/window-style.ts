/**
 * The depth between windows, as dashi-comp draws it (IPC `window-style`,
 * docs/compositor-ipc.md; docs/design.html, "Window depth"). The look is
 * decided here and sent whole: a soft shadow under every window, deeper on
 * the one with the keyboard; a hairline just inside every frame (the menu
 * bar's edge token); and, with Settings › Appearance › "Highlight the active
 * window", a ring in the accent color around the focused window instead of
 * its hairline. Tiles cast a short shadow that shades the 6 px gap and not
 * the neighbor; a filled window casts none and has no hairline (they would
 * only fall on the menu bar, its own edge, and the Dock), though it keeps
 * the ring; sheets cast the sheet shadow (`xl`). Dark Mode raises every
 * shadow's alpha by half, since dark windows on a dark desktop need more
 * to separate. Focus changes cross-fade over 150 ms; Reduce Motion
 * makes them instant. The style is sent at start and again only when one
 * of its inputs changes it.
 */

import { darkColors, lightColors } from "@dashi/ui";
import type { Requester } from "../settings.ts";

/** One shadow, in logical pixels, as CSS `box-shadow` has it: black at `alpha`. */
export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  spread: number;
  alpha: number;
}

export interface WindowLine {
  color: string;
  width: number;
}

/** What `window-style` carries. */
export interface WindowStyle {
  shadow: { focused: ShadowLayer[]; other: ShadowLayer[]; tiled: ShadowLayer[]; filled: ShadowLayer[]; sheet: ShadowLayer[] };
  /** `filled`: whether a filled window has the hairline too. */
  edge: WindowLine & { filled: boolean };
  ring: WindowLine & { on: boolean };
  fade: number;
}

export interface WindowStyleInputs {
  dark: boolean;
  /** Settings › Appearance › "Highlight the active window". */
  highlight: boolean;
  reduceMotion: boolean;
}

const layer = (y: number, blur: number, spread: number, alpha: number): ShadowLayer => ({ x: 0, y, blur, spread, alpha });

/** Light mode's shadows; Dark Mode multiplies each alpha by DARK_ALPHA. */
export const SHADOWS = {
  focused: [layer(18, 40, -8, 0.38), layer(2, 6, 0, 0.16)],
  other: [layer(8, 20, -6, 0.22)],
  tiled: [layer(0, 8, 0, 0.2)],
  filled: [],
  // The `xl` preset (docs/design.html, Shadows).
  sheet: [layer(20, 25, -5, 0.1), layer(8, 10, -6, 0.1)],
} as const satisfies Record<keyof WindowStyle["shadow"], readonly ShadowLayer[]>;

export const DARK_ALPHA = 1.5;
export const EDGE_WIDTH = 1;
export const RING_WIDTH = 1.5;
export const FOCUS_FADE_MS = 150;

const round = (value: number): number => Math.round(value * 1000) / 1000;

export function windowStyle({ dark, highlight, reduceMotion }: WindowStyleInputs): WindowStyle {
  const palette = dark ? darkColors : lightColors;
  const tone = (layers: readonly ShadowLayer[]): ShadowLayer[] =>
    layers.map((each) => ({ ...each, alpha: dark ? round(Math.min(1, each.alpha * DARK_ALPHA)) : each.alpha }));
  return {
    shadow: {
      focused: tone(SHADOWS.focused),
      other: tone(SHADOWS.other),
      tiled: tone(SHADOWS.tiled),
      filled: tone(SHADOWS.filled),
      sheet: tone(SHADOWS.sheet),
    },
    edge: { color: palette.menuBarEdge, width: EDGE_WIDTH, filled: false },
    ring: { on: highlight, color: palette.selection, width: RING_WIDTH },
    fade: reduceMotion ? 0 : FOCUS_FADE_MS,
  };
}

/** Sends the style when it is first known and whenever an input changes it. */
export class WindowStyleSync {
  private inputs: Partial<WindowStyleInputs> = {};
  private sent: string | null = null;

  constructor(private readonly compositor: Requester) {}

  set(change: Partial<WindowStyleInputs>): void {
    this.inputs = { ...this.inputs, ...change };
    const { dark, highlight, reduceMotion } = this.inputs;
    // Until Dark Mode and the settings are both known, nothing is sent (no flash of the wrong look).
    if (dark === undefined || highlight === undefined || reduceMotion === undefined) return;
    const style = windowStyle({ dark, highlight, reduceMotion });
    const key = JSON.stringify(style);
    if (key === this.sent) return;
    this.sent = key;
    this.compositor.request("window-style", { ...style }).catch((error) => {
      this.sent = null;
      console.error("dashi-shell: windows keep their old depth:", error);
    });
  }
}
