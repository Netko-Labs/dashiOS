/**
 * Control Center's tokens (the approved design, docs/design.html "Control
 * Center"): a soft surface, off tiles a shade of it, on tiles Dashi green,
 * sliders filled with ink (dark in Light, light in Dark), and the purple
 * keyboard ring. The battery panel, the Wi-Fi, Bluetooth and Sound pages,
 * and System Settings draw with the same ones; Settings adds its window,
 * its sidebar, and a knob's resting circle (docs/design.html "Settings").
 */

import { useDark } from "@dashi/ui";

export interface ControlPalette {
  /** The panel. */
  surface: string;
  /** An off tile, a page row, a slider's track. */
  off: string;
  offInk: string;
  /** An on tile: Dashi green. */
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
  /** The chip a slider's glyph and a flat slider's label sit on. */
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
}

export const LIGHT_CONTROLS: ControlPalette = {
  surface: "#f3eff8",
  off: "#e4ddee",
  offInk: "#1d1830",
  on: "#2f6f5b",
  onInk: "#ffffff",
  knobOn: "#ffffff2e",
  knobOff: "#1d18300f",
  fill: "#1d1830",
  fillInk: "#f3eff8",
  text: "#1d1830",
  muted: "#1d183094",
  line: "#1d18301f",
  chip: "#f3eff8",
  focus: "#6e56cf",
  window: "#f7f4fa",
  sidebar: "#efeaf5",
  knobRest: "#1d18301a",
  lit: "#1d183017",
};

export const DARK_CONTROLS: ControlPalette = {
  surface: "#1c1a22",
  off: "#2b2834",
  offInk: "#ebe7f3",
  on: "#86d3b6",
  onInk: "#0b2a20",
  knobOn: "#0b2a201f",
  knobOff: "#ffffff0d",
  fill: "#ebe7f3",
  fillInk: "#1c1a22",
  text: "#ebe7f3",
  muted: "#ebe7f38c",
  line: "#ffffff1a",
  chip: "#1c1a22",
  focus: "#6e56cf",
  window: "#1a1820",
  sidebar: "#211e28",
  knobRest: "#ffffff1a",
  lit: "#ebe7f31f",
};

export const controlPalette = (dark: boolean): ControlPalette => (dark ? DARK_CONTROLS : LIGHT_CONTROLS);

export function useControlColors(): ControlPalette {
  return controlPalette(useDark());
}
