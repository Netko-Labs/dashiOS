/**
 * Frosted glass. The direction is Frost (decisions.md D720 to D729; design.html "Glass", DE-4, GL-1 to
 * GL-4): four neutral materials, each a blur of what is behind, a saturation lift, a tint per mode that
 * the contrast floor raises (never lowers) until the surface's weakest words keep 4.5:1, a static grain,
 * a light rim and a dark hairline. Every number here is the shell's (D713): the compositor only draws
 * them (y3), mirin's `material` names the level (y2), and the kit's surfaces wear it (y4: `Frosted`, and
 * on-glass.ts for what is painted on it). Values only, all in `GLASS` (at the end).
 */

import { GLASS_SURFACES } from "./glass-surfaces.ts";
import { INK_PAPER } from "./inks.ts";
import type { Oklch } from "./lib/oklch.ts";

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
 * The materials (DE-4). Thin: the menu bar, the Dock, the taskbar, the Spaces row, the lock's power
 * buttons. Regular: menus, Control Center, the launcher and its conversation, banners, sheets, the OSD,
 * the switcher, panels, the capsule's card, the lock's field and Today. Thick: the focused window's
 * sidebar (its solid twin without focus). Paper: widgets and the area's notification cards (CO-11).
 */
const LEVELS: Readonly<Record<GlassLevel, GlassMaterial>> = {
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
 * The veil (D722, Frost v2): the whole wallpaper frosted, under the lock, the login screen and (with no
 * tint and no floor) the overview. Its tint is shaped by what sits on it: on the lock a band behind the
 * clock and who signs in, feathered to a quarter at the sides. It has no solid twin: where glass is off
 * the wallpaper shows sharp under the lock's own wash (LOGIN, LOGIN_LIGHT). Its floor reads the hardest
 * ground within `floorReach` points of each pixel, as lock-v3 floored the whole veil from where its words
 * sit: the lake's light and shade still show through, where a floor per pixel flattened them into one
 * pastel (D822).
 */
const VEIL = {
  blur: 24,
  saturation: 1.2,
  floorReach: 137,
  light: { tint: "#F6F6F8", least: 0.12 },
  dark: { tint: "#0A0A0C", least: 0.18 },
} as const;

/** The grain on every material: static, never animated, from one tile, so a smooth blur never bands. */
const GRAIN = {
  /** Its strength, grey ± this. */
  amount: 0.035,
  /** The tile's side, in points. */
  tile: 160,
} as const;

/** The rim: a line inside the edge, white from the top down at these α (light from above). */
const RIM = {
  width: 1,
  light: { top: 0.85, middle: 0.35, bottom: 0.15 },
  dark: { top: 0.28, middle: 0.1, bottom: 0.06 },
} as const;

/** The hairline (Frost's "keel"): a black line just outside the edge, at this α, so the edge holds on any backdrop. */
const HAIRLINE = { width: 0.5, light: 0.1, dark: 0.5 } as const;

/**
 * The floor: the tint's α is the least α, or the lowest that keeps every ground under the surface, against
 * every ink it names (GL-5), at `ratio` (words) or `glyphs` (marks) + `margin`, the grain at both
 * extremes, and on its fills too when words sit on them (D729). It rises at once and falls only after
 * `fallAfterMs` of stillness, easing over MOTION.base; the backdrop's tone goes to the client at most
 * every `toneEveryMs`. In battery saver it runs once per wallpaper.
 */
const FLOOR = { ratio: 4.5, glyphs: 3, margin: 0.15, fallAfterMs: 300, toneEveryMs: 120 } as const;

/** A fill inside glass (a tile, a field, a bubble, a card's choice): white at this α, laid on the glass. */
const FILL = { light: 0.55, dark: 0.1 } as const;

/**
 * The glass control edge (CO-6, D766): a button's, a field's or an off switch's edge on glass, ink at
 * `light` in Light and white at `dark` in Dark, 3:1 on the floored ground.
 */
const EDGE = { light: 0.56, dark: 0.44 } as const;

/**
 * A selection on glass (CO-9): the accent's wash at `wash` over the floored ground, its words primary. In a
 * window without focus it is neutral: ink at `unfocusedWash`, its bar ink at `unfocusedBar`.
 */
const SELECTION = { wash: 0.22, unfocusedWash: 0.1, unfocusedBar: 0.55 } as const;

/** The gap of the focus ring where it crosses something lit in the accent (KB-2, D763): onAccent, in points. */
const FOCUS_GAP = 1.5;

/**
 * Words and glyphs on glass (GL-1): a grey that leans a breath to the backdrop's hue (H, from the
 * compositor's tone), at this lightness and at most this chroma. Light stays light (D725): the glass
 * whitens over a dark wallpaper and its words never flip.
 */
const INK: Readonly<Record<"light" | "dark", { primary: Omit<Oklch, "H">; secondary: Omit<Oklch, "H"> }>> = {
  light: { primary: { L: 0.2, C: 0.02 }, secondary: { L: 0.43, C: 0.035 } },
  dark: { primary: { L: 0.955, C: 0.012 }, secondary: { L: 0.8, C: 0.03 } },
};

/** How deep glass goes (GL-2): a surface sees at most this many glass layers under it; one more is its solid twin. */
const DEPTH = { layers: 2 } as const;

/**
 * Where glass gives way (GL-3): all glass together keeps under `budgetMs` of a frame; after `misses`
 * missed budgets in a row the oldest layer is kept as it is, then turns to its solid twin.
 */
const BUDGET = { budgetMs: 1.5, misses: 2 } as const;

/** Glass frosting in (MO-4): its words fade in `wordsAfterMs` after the panel starts to open. */
const FROST = { wordsAfterMs: 40 } as const;

/**
 * A card on air (CO-12, D724 as corrected by D768): its paper glass stays as off air; it glows faintly in
 * its own ink (a shadow 0 0 `blur` `spread`, the ink at `light` / `dark`), and the "Now" tag carries the
 * tally's dot. No stain, no lift, no ring, no flood.
 */
const ON_AIR = { blur: 30, spread: 3, light: 0.6, dark: 0.55 } as const;

/**
 * Inks one step darker (Light) or lighter (Dark) on glass (GL-5, D762), so the floor need not go solid for
 * them: Light matcha (D726), Light ume words, Light wakame, Light microphone (its pill's wash at
 * `microphoneWash`), and Dark ume on a fill.
 */
const INKS_ON_GLASS = {
  light: { matcha: "#5F6305", ume: "#A0324A", wakame: "#00737E", microphone: "#9F4800" },
  dark: { umeOnFill: "#F6859B" },
  microphoneWash: 0.12,
} as const;

/**
 * Frost, every number in one token (design.html "Glass" binds each): `levels` (`GLASS.levels.thin.blur`),
 * the `veil`, the parts every level has, and the surfaces the glass rounds drew (`glass-surfaces.ts`).
 */
export const GLASS = {
  levels: LEVELS,
  veil: VEIL,
  grain: GRAIN,
  rim: RIM,
  hairline: HAIRLINE,
  floor: FLOOR,
  ink: INK,
  depth: DEPTH,
  budget: BUDGET,
  frost: FROST,
  onAir: ON_AIR,
  inks: INKS_ON_GLASS,
  fill: FILL,
  edge: EDGE,
  selection: SELECTION,
  focusGap: FOCUS_GAP,
  ...GLASS_SURFACES,
} as const;
