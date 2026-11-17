/**
 * The inks (widgets, round five, "Inks", decisions.md D400): Tally's neutral
 * paper, with each first-party widget's number printed in its category's ink.
 * Fixed tokens, never the wallpaper's and never the accent's (the accent
 * paints controls; it never paints widgets, the lock screen or Glance). They
 * are spaced so every pair stays apart in OKLab and step in lightness (miso
 * darkest), and every hero ink passes 4.5:1 on its paper. The tally is one
 * vermilion; a flooded card swaps paper and ink (`onInk` on the ink).
 *
 * Only three transforms exist: house lights (`dim`: 15 % chroma, halfway to
 * a quiet tone), the lock screen's lightness shift (`lock`), and nothing else.
 */

import { type Oklch, oklchToHex } from "./lib/oklch.ts";

export type InkName = "miso" | "mizu" | "matcha" | "wakame" | "shiso" | "album";
export type InkMode = "light" | "dark";

export interface InkSpec {
  /** What prints in it. */
  what: string;
  /** The glyph that carries the category wherever colour alone would have to. */
  glyph: string;
  light: Oklch;
  dark: Oklch;
}

/**
 * The six inks. The timer is wakame, a teal (the owner's call of 16 Nov:
 * out of the amber range beside broth and the microphone): lightest in both
 * modes, as kabocha was, so the lightness order stays.
 */
export const INKS: Readonly<Record<InkName, InkSpec>> = {
  miso: { what: "Calendar", glyph: "cal", light: { L: 0.4, C: 0.06, H: 40 }, dark: { L: 0.68, C: 0.055, H: 40 } },
  mizu: { what: "Weather", glyph: "partly", light: { L: 0.47, C: 0.11, H: 230 }, dark: { L: 0.76, C: 0.1, H: 230 } },
  matcha: { what: "Battery", glyph: "bolt", light: { L: 0.52, C: 0.13, H: 112 }, dark: { L: 0.83, C: 0.14, H: 125 } },
  wakame: { what: "Timer", glyph: "timer", light: { L: 0.545, C: 0.1, H: 205 }, dark: { L: 0.88, C: 0.1, H: 200 } },
  shiso: { what: "Agents", glyph: "spark", light: { L: 0.47, C: 0.14, H: 288 }, dark: { L: 0.76, C: 0.12, H: 290 } },
  album: { what: "Music, the sleeve's colour", glyph: "music", light: { L: 0.5, C: 0.12, H: 334 }, dark: { L: 0.72, C: 0.11, H: 334 } },
};

export const INK_NAMES = Object.keys(INKS) as InkName[];

/** The tally: one vermilion everywhere, chroma 0.19. */
export const TALLY: Readonly<Record<InkMode, Oklch>> = {
  light: { L: 0.6, C: 0.19, H: 36 },
  dark: { L: 0.7, C: 0.19, H: 38 },
};

/** The paper widgets are printed on, and the words on a flooded card. */
export const INK_PAPER: Readonly<Record<InkMode, string>> = { light: "#FBFBF9", dark: "#0B0B0C" };
export const ON_INK: Readonly<Record<InkMode, string>> = { light: "#FFFFFF", dark: "#0B0B0C" };
/** Words on paper: the ink and the two quieter steps (round five, #11). */
export const INK_TEXT: Readonly<Record<InkMode, { ink: string; secondary: string; tertiary: string; hairline: string }>> = {
  light: { ink: "#1D1D1F", secondary: "#4F4F50", tertiary: "#6B6B6B", hairline: "#1D1D1F1F" },
  dark: { ink: "#ECECEE", secondary: "#B4B4B2", tertiary: "#8E8E8C", hairline: "#FFFFFF1F" },
};

/** The transforms' numbers, in one place. */
export const INK_RULE = { houseChroma: 0.15, houseL: 0.62, lockL: { light: 0.05, dark: -0.04 } } as const;

export interface InkOptions {
  /** House lights are down: something critical asks or something is due, and this is not it. */
  dim?: boolean;
  /** Drawn on the lock screen's wash, whose ink is the opposite of the mode's paper. */
  lock?: boolean;
}

/** One ink as `#RRGGBB`. */
export function inkHex(name: InkName, mode: InkMode, options: InkOptions = {}): string {
  const spec = INKS[name][mode];
  let { L, C } = spec;
  if (options.lock) L += INK_RULE.lockL[mode];
  if (options.dim) {
    C *= INK_RULE.houseChroma;
    L = (L + INK_RULE.houseL) / 2;
  }
  return oklchToHex({ L, C, H: spec.H });
}

export function tallyHex(mode: InkMode): string {
  return oklchToHex(TALLY[mode]);
}

/** What a surface paints its widgets with: each ink, its dimmed twin, the tally, and the flood's words. */
export interface InkTokens {
  ink: Readonly<Record<InkName, string>>;
  dimmed: Readonly<Record<InkName, string>>;
  tally: string;
  /** The tally washed: the "Now" tag's ground on paper. */
  tallyWash: string;
  onInk: string;
  paper: string;
  text: (typeof INK_TEXT)[InkMode];
}

const cache = new Map<string, InkTokens>();

/** Every ink for one mode, computed once (the transforms are pure). */
export function inkTokens(mode: InkMode, options: Pick<InkOptions, "lock"> = {}): InkTokens {
  const key = `${mode}:${options.lock === true}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ink = {} as Record<InkName, string>;
  const dimmed = {} as Record<InkName, string>;
  for (const name of INK_NAMES) {
    ink[name] = inkHex(name, mode, options);
    dimmed[name] = inkHex(name, mode, { ...options, dim: true });
  }
  const tally = tallyHex(mode);
  const tokens: InkTokens = { ink, dimmed, tally, tallyWash: `${tally}24`, onInk: ON_INK[mode], paper: INK_PAPER[mode], text: INK_TEXT[mode] };
  cache.set(key, tokens);
  return tokens;
}
