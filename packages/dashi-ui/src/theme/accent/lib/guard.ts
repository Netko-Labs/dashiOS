/**
 * The accent's guard (dashi-0.9.0-design/accent/README.md, "The guard"; the
 * same maths as its src/accent.js). Rules 1 and 2 move the seed out of the
 * tally's band and away from the agents' purple; rules 3 and 4 move only
 * what is drawn from it, per mode, until fills hold 3:1 and words 4.5:1 on
 * every window ground (4.5:1 and 7:1 with Increase contrast).
 */

import { contrast, deltaE, hexToOklch, oklchToHex, over } from "./oklch.ts";

export type Mode = "light" | "dark";

/** Why a pick was drawn other than as picked. */
export type Move = "signal" | "agent" | "contrast";

/** What the accent must never be mistaken for: fixed, the accent moves, never these. */
export const FIXED = {
  tally: { light: "#D9471B", dark: "#FD6A3A" },
  microphone: { light: "#B85A12", dark: "#F0954A" },
  shiso: { light: "#6E56CF", dark: "#8B76E8" },
} as const;

export const RULE = {
  /** Below this chroma an accent reads as a grey or a brown: no hue rule applies. */
  loud: 0.07,
  /** Scarlet to amber, the tally's and the microphone's band: chroma is capped here. */
  signal: [15, 90] as const,
  signalCap: 0.07,
  /** Any fill stays at least this far (OKLab) from the tally and the microphone. */
  apart: 0.1,
  /** Degrees kept between the accent and the agents' purple (the keyboard's ring too). */
  agentGap: 40,
  edge: 3,
  text: 4.5,
  edgeHC: 4.5,
  textHC: 7,
} as const;

/** Every window ground in each mode: window, Settings, glass, sidebar; true black and its lifts. */
export const GROUNDS: Readonly<Record<Mode, readonly string[]>> = {
  light: ["#FFFFFF", "#F7F4FA", "#F5F5F7", "#F6F4EF"],
  dark: ["#000000", "#0B0B0D", "#141417"],
};

/** The page's own ink, which must still read on a wash. */
export const INK: Readonly<Record<Mode, string>> = { light: "#1D1D1F", dark: "#ECECEE" };

const WHITE = "#FFFFFF";
const DARK_WORDS = "#111113";

export const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export const minContrast = (hex: string, grounds: readonly string[]): number => Math.min(...grounds.map((ground) => contrast(hex, ground)));

/** Rules 1 and 2: the seed, out of the bands it must not be in, and why it moved. */
export function guardHue(seed: string, agent: string = FIXED.shiso.light): { seed: string; moves: Move[] } {
  const c = hexToOklch(seed);
  const moves: Move[] = [];
  if (c.C >= RULE.loud && c.H >= RULE.signal[0] && c.H <= RULE.signal[1]) {
    c.C = RULE.signalCap;
    moves.push("signal");
  }
  if (c.C >= RULE.loud) {
    for (const other of new Set([FIXED.shiso.light, agent])) {
      const H = hexToOklch(other).H;
      if (hueGap(c.H, H) >= RULE.agentGap) continue;
      const up = (H + RULE.agentGap + 2) % 360;
      const down = (H - RULE.agentGap - 2 + 360) % 360;
      c.H = hueGap(c.H, up) < hueGap(c.H, down) ? up : down;
      moves.push("agent");
    }
  }
  return { seed: moves.length > 0 ? oklchToHex(c) : seed.toUpperCase(), moves };
}

/** Walk lightness one way (-1 deeper, +1 lighter) until `test` holds; chroma drops only for gamut. */
export function walk(hex: string, dir: number, test: (hex: string) => boolean): string {
  const c = hexToOklch(hex);
  let out = hex.toUpperCase();
  for (let i = 0; i < 100 && !test(out); i++) {
    c.L = Math.min(0.98, Math.max(0.05, c.L + dir * 0.01));
    out = oklchToHex(c);
  }
  return out;
}

export interface GuardOptions {
  /** Increase contrast: the stricter targets. */
  hc?: boolean;
  /** The agents' colour, if the person changed it in Your Dashi. */
  agent?: string;
}

/** What one seed draws in one mode. */
export interface Drawn {
  /** The seed after rules 1 and 2. */
  seed: string;
  /** Switches, ticks, a chosen pill, progress, a menu highlight, the window's ring. */
  fill: string;
  /** Words and glyphs on `fill`: white or near-black. */
  on: string;
  /** Links and words in the accent. */
  ink: string;
  /** A selected row's wash and selected text's, as `#RRGGBBAA`. */
  wash: string;
  text: string;
  moved: Move[];
}

const fillOf = (seed: string, mode: Mode, hc: boolean): string =>
  walk(seed, mode === "light" ? -1 : 1, (hex) => minContrast(hex, GROUNDS[mode]) >= (hc ? RULE.edgeHC : RULE.edge));

/** Rules 3 and 4, after 1 and 2: the tokens one seed draws in `mode`. */
export function derive(picked: string, mode: Mode, options: GuardOptions = {}): Drawn {
  const hc = options.hc === true;
  let { seed, moves } = guardHue(picked, options.agent);
  // Never near the tally or the microphone as drawn in this mode: quieten the seed until it is apart.
  const near = (hex: string): boolean => {
    const fill = fillOf(hex, mode, hc);
    return deltaE(fill, FIXED.tally[mode]) < RULE.apart || deltaE(fill, FIXED.microphone[mode]) < RULE.apart;
  };
  if (near(seed)) {
    const c = hexToOklch(seed);
    while (near(oklchToHex(c)) && c.C > 0.02) c.C -= 0.01;
    seed = oklchToHex(c);
    if (!moves.includes("signal")) moves = [...moves, "signal"];
  }
  const text = hc ? RULE.textHC : RULE.text;
  const grounds = GROUNDS[mode];
  const fill = fillOf(seed, mode, hc);
  const onOf = (hex: string): string | null => (contrast(hex, WHITE) >= text ? WHITE : contrast(hex, DARK_WORDS) >= text ? DARK_WORDS : null);
  let f = fill;
  if (!onOf(f)) f = walk(f, contrast(f, WHITE) > contrast(f, DARK_WORDS) ? -1 : 1, (hex) => onOf(hex) !== null);
  const ink = walk(seed, mode === "light" ? -1 : 1, (hex) => minContrast(hex, grounds) >= text);
  // Rule 4: the page's ink still reads on the wash over every ground, so a wash thins until it does.
  const washOf = (want: number): string => {
    let alpha = want;
    while (alpha > 0.08 && grounds.some((ground) => contrast(INK[mode], over(f, alpha, ground)) < text)) alpha -= 0.02;
    return `${f}${Math.floor(alpha * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()}`;
  };
  const [rowWash, textWash] = mode === "light" ? [0x24 / 255, 0x40 / 255] : [0x38 / 255, 0x80 / 255];
  const moved: Move[] = fill !== seed.toUpperCase() || f !== fill ? [...moves, "contrast"] : moves;
  return { seed, fill: f, on: onOf(f) ?? WHITE, ink, wash: washOf(rowWash), text: washOf(textWash), moved };
}

/**
 * A fill under the pointer and held: 0.04 and 0.08 of OKLCH lightness away
 * from its words (deeper under white, lighter under near-black), so the words
 * stay AA on all three; a step that would lose them is not taken.
 */
export function steps(fill: string, on: string, hc = false): [string, string] {
  const dir = on === WHITE ? -1 : 1;
  const text = hc ? RULE.textHC : RULE.text;
  const step = (by: number): string => {
    const c = hexToOklch(fill);
    c.L = Math.min(0.98, Math.max(0.05, c.L + dir * by));
    const hex = oklchToHex(c);
    return contrast(hex, on) >= text ? hex : fill;
  };
  return [step(0.04), step(0.08)];
}
