/**
 * Frosted glass. The direction is Frost (decisions.md D720 to D729; design.html "Glass", DE-4, GL-1 to
 * GL-4): four neutral materials, each a blur of what is behind, a saturation lift, a tint per mode that
 * the contrast floor raises (never lowers) until the surface's weakest words keep 4.5:1, a static grain,
 * a light rim and a dark hairline. Every number here is the shell's (D713): the compositor only draws
 * them (y3), mirin's `material` names the level (y2), and the kit's surfaces wear it (y4). Values only:
 * nothing reads the Frost tokens yet but design.html (H24).
 *
 * `GLASS_TINTS` is the spike's (D710, D713): the launcher's tint, still what `DASHI_GLASS` draws.
 */

import { useDark } from "./appearance.ts";
import { INK_PAPER } from "./inks.ts";
import type { Oklch } from "./lib/oklch.ts";
import { lightColors, TRUE_BLACK } from "./palette.ts";

/** Each frosted surface's tint, by mode (the spike's, D713). */
export const GLASS_TINTS = {
  light: { launcher: `${lightColors.launcher}b3` },
  dark: { launcher: `${TRUE_BLACK.lift}b3` },
} as const;

/** The tints for the mode right now. */
export function useGlassTints(): { launcher: string } {
  return useDark() ? GLASS_TINTS.dark : GLASS_TINTS.light;
}

/** Frost's four materials, thinnest first. */
export type GlassLevel = "thin" | "regular" | "thick" | "paper";

/** A material in one mode: its tint, the least α the floor starts from, and its solid twin. */
export interface GlassTone {
  /** The tint laid over the blur, `#RRGGBB`; its α is the floor's. */
  tint: string;
  /** The tint's α never falls below this; the floor raises it where the words need it. */
  least: number;
  /** What the material turns into where glass is off (GL-3): opaque, `#RRGGBB`. */
  solid: string;
}

export interface GlassMaterial {
  /** The blur's σ, in points (about CSS's `blur()`). */
  blur: number;
  /** The colour behind lifted by this (1 is none). */
  saturation: number;
  light: GlassTone;
  dark: GlassTone;
}

/**
 * The materials (DE-4). Thin: the menu bar, the Dock. Regular: menus, Control Center, the launcher and
 * its conversation, banners, sheets, the lock's field. Thick: the focused window's sidebar. Paper:
 * widgets (the Inks' paper turned glass, CO-11).
 */
export const GLASS: Readonly<Record<GlassLevel, GlassMaterial>> = {
  thin: {
    blur: 18,
    saturation: 1.8,
    light: { tint: "#F6F6F8", least: 0.44, solid: "#ECECEF" },
    dark: { tint: "#161618", least: 0.42, solid: "#161618" },
  },
  regular: {
    blur: 30,
    saturation: 1.6,
    light: { tint: "#F8F8FA", least: 0.62, solid: "#F7F7F9" },
    dark: { tint: "#1C1C1F", least: 0.58, solid: "#1C1C1F" },
  },
  thick: {
    blur: 44,
    saturation: 1.4,
    light: { tint: "#EEEEF2", least: 0.72, solid: "#E8E8EC" },
    dark: { tint: "#111113", least: 0.68, solid: "#0B0B0D" },
  },
  paper: {
    blur: 30,
    saturation: 1.4,
    light: { tint: INK_PAPER.light, least: 0.64, solid: INK_PAPER.light },
    dark: { tint: INK_PAPER.dark, least: 0.6, solid: INK_PAPER.dark },
  },
};

/**
 * The lock screen's veil (D722): the whole wallpaper frosted, thickest in a band where the clock and
 * the password are. It has no solid twin: where glass is off the wallpaper shows sharp under the
 * lock's own wash (LOGIN, LOGIN_LIGHT).
 */
export const GLASS_VEIL = {
  blur: 10,
  saturation: 1.15,
  light: { tint: "#F6F6F8", least: 0.12 },
  dark: { tint: "#0A0A0C", least: 0.18 },
} as const;

/** The grain on every material: static, never animated, from one tile, so a smooth blur never bands. */
export const GLASS_GRAIN = {
  /** Its strength, grey ± this. */
  amount: 0.035,
  /** The tile's side, in points. */
  tile: 160,
} as const;

/** The rim: a line inside the edge, white from the top down at these α (light from above). */
export const GLASS_RIM = {
  width: 1,
  light: { top: 0.85, middle: 0.35, bottom: 0.15 },
  dark: { top: 0.28, middle: 0.1, bottom: 0.06 },
} as const;

/** The hairline (Frost's "keel"): a black line just outside the edge, at this α, so the edge holds on any backdrop. */
export const GLASS_HAIRLINE = { width: 0.5, light: 0.1, dark: 0.5 } as const;

/**
 * The floor: the tint's α is the least α, or the lowest that keeps every ground under the surface at
 * `ratio` + `margin` against its weakest ink, the grain at both extremes. It rises at once and falls only
 * after `fallAfterMs` of stillness, easing over MOTION.base; the backdrop's tone goes to the client at
 * most every `toneEveryMs`.
 */
export const GLASS_FLOOR = { ratio: 4.5, margin: 0.15, fallAfterMs: 300, toneEveryMs: 120 } as const;

/**
 * Words and glyphs on glass (GL-1): a grey that leans a breath to the backdrop's hue (H, from the
 * compositor's tone), at this lightness and at most this chroma. Light stays light (D725): the glass
 * whitens over a dark wallpaper and its words never flip.
 */
export const GLASS_INK: Readonly<Record<"light" | "dark", { primary: Omit<Oklch, "H">; secondary: Omit<Oklch, "H"> }>> = {
  light: { primary: { L: 0.2, C: 0.02 }, secondary: { L: 0.43, C: 0.035 } },
  dark: { primary: { L: 0.955, C: 0.012 }, secondary: { L: 0.8, C: 0.03 } },
};

/** How deep glass goes (GL-2): a surface sees at most this many glass layers under it; one more is its solid twin. */
export const GLASS_DEPTH = { layers: 2 } as const;

/**
 * Where glass gives way (GL-3): all glass together keeps under `budgetMs` of a frame; after `misses`
 * missed budgets in a row the oldest layer is kept as it is, then turns to its solid twin.
 */
export const GLASS_BUDGET = { budgetMs: 1.5, misses: 2 } as const;

/** Glass frosting in (MO-4): its words fade in `wordsAfterMs` after the panel starts to open. */
export const GLASS_FROST = { wordsAfterMs: 40 } as const;

/**
 * A widget on air (CO-12, D724): its paper glass takes `stain` of its own ink into the tint (still
 * floored), it lifts `lift` points, and its glow is the `lg` shadow in its ink at `glow`.
 */
export const GLASS_ON_AIR = { stain: 0.14, glow: 0.5, lift: 2 } as const;

/**
 * Inks that change on glass (D726): Light matcha is one step darker on paper glass (L 0.52 → 0.48), so
 * the battery widget's glass need not go almost solid to keep it 4.5:1.
 */
export const GLASS_INKS: Readonly<{ matcha: { light: Oklch } }> = {
  matcha: { light: { L: 0.48, C: 0.13, H: 112 } },
};
