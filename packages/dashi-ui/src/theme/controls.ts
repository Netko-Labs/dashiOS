/**
 * The panel look's colours (TK-2; docs/design.html "Control Center" and
 * "Settings"): a soft surface, off tiles a shade of it, on tiles in the one
 * "on" (the guard's `selection` under `onAccent`, R2: the same in every kit),
 * sliders filled with ink (dark in Light, light in Dark), and the keyboard's
 * ring, `focusRing`. Control Center, the battery panel, its pages and
 * Settings draw with them; Settings adds its window, its sidebar and a knob's
 * resting circle.
 */

import { onOf } from "./colors.ts";
import { darkColors, lightColors, TRUE_BLACK } from "./palette.ts";
import { paletteFor } from "./palette-for.ts";

export interface ControlPalette {
  /** The panel. */
  surface: string;
  /** An off tile, a page row, a slider's track. */
  off: string;
  offInk: string;
  /** An on tile, a chosen pill, a switch that is on: the one "on" (CO-1). */
  on: string;
  onInk: string;
  /** The knob on an on tile, and on an off one. */
  knobOn: string;
  knobOff: string;
  /** A slider's fill and the words on it. */
  fill: string;
  fillInk: string;
  /** Text on the surface, and quieter. */
  text: string;
  muted: string;
  /** Hairlines, a gauge's track. */
  line: string;
  /** The disc a slider's glyph and a flat slider's label sit on. */
  chip: string;
  /** The keyboard's ring. */
  focus: string;
  /** Settings' window, behind its cards. */
  window: string;
  /** Settings' sidebar. */
  sidebar: string;
  /** A knob's circle at rest: a Settings row's glyph, a sidebar pill's. */
  knobRest: string;
  /** The soft ink wash on the row a link or the search lands on (purple stays the keyboard's and the agents'). */
  lit: string;
  /** On glass only: the glass control edge (CO-6, CC-1), a knob's, an outline pill's and an off switch's outline. */
  edge?: string;
}

/** The knob's wash on an on tile: the words' colour, faint. */
const knobOnFor = (onInk: string): string => `${onInk}${onInk.toLowerCase() === "#ffffff" ? "2e" : "1f"}`;

const LIGHT_ON = onOf(lightColors);
const DARK_ON = onOf(darkColors);

export const LIGHT_CONTROLS: ControlPalette = {
  surface: "#f3eff8",
  off: "#e4ddee",
  offInk: "#1d1830",
  ...LIGHT_ON,
  knobOn: knobOnFor(LIGHT_ON.onInk),
  knobOff: "#1d18300f",
  fill: "#1d1830",
  fillInk: "#f3eff8",
  text: "#1d1830",
  muted: "#1d183094",
  line: "#1d18301f",
  chip: "#f3eff8",
  focus: lightColors.focusRing,
  window: "#f7f4fa",
  sidebar: "#efeaf5",
  knobRest: "#1d18301a",
  lit: "#1d183017",
};

/**
 * Dark is true black: the panel and Settings' window are the black ground
 * itself, the sidebar the first lift, off tiles and cards the second; the
 * panel's edge is a hairline (`line`), since its shadow has nothing to darken.
 */
export const DARK_CONTROLS: ControlPalette = {
  surface: TRUE_BLACK.ground,
  off: TRUE_BLACK.raised,
  offInk: TRUE_BLACK.ink,
  ...DARK_ON,
  knobOn: knobOnFor(DARK_ON.onInk),
  knobOff: "#ffffff0d",
  fill: TRUE_BLACK.ink,
  fillInk: TRUE_BLACK.ground,
  text: TRUE_BLACK.ink,
  muted: `${TRUE_BLACK.ink}99`,
  line: TRUE_BLACK.edge,
  chip: TRUE_BLACK.ground,
  focus: darkColors.focusRing,
  window: TRUE_BLACK.ground,
  sidebar: TRUE_BLACK.lift,
  knobRest: "#ffffff1a",
  lit: `${TRUE_BLACK.ink}1f`,
};

const accented = new Map<string, ControlPalette>();

/** The panel look's colours in a mode, with the person's accent drawn into "on" as every kit draws it (paletteFor). */
export function controlPalette(dark: boolean, accent: string | null = null): ControlPalette {
  const base = dark ? DARK_CONTROLS : LIGHT_CONTROLS;
  const { on, onInk } = onOf(paletteFor(dark, accent));
  if (on === base.on && onInk === base.onInk) return base;
  const key = `${on}|${onInk}|${dark}`;
  let palette = accented.get(key);
  if (!palette) {
    palette = { ...base, on, onInk, knobOn: knobOnFor(onInk) };
    if (accented.size > 32) accented.clear();
    accented.set(key, palette);
  }
  return palette;
}
