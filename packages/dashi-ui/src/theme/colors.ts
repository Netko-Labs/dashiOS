/**
 * The colours the palette was missing (docs/design.html CO-5): names for what
 * modules wrote as hex. No hex outside theme/ (H21): "no fill" is CLEAR,
 * words on a fill are onAccent, onPrimary, onAgent or onTint, never a loose
 * white, and each fixed set a module used to keep lives here, checked by
 * contrast.test.ts.
 */

import { type Palette, TRUE_BLACK } from "./palette.ts";

/** No fill: a view that paints nothing. */
export const CLEAR = "#00000000";
/**
 * A fill nobody sees that still takes the pointer: Metal hands the pointer
 * only to what paints, so a hit area paints one step above nothing.
 */
export const HIT_AREA = "#00000001";

/** A switch's and a slider's knob: white in both modes, lifted by its shadow. */
export const KNOB = "#ffffff";
/** Words on ume's fill (a destructive button): white, AA on every step of it. */
export const ON_DANGER = "#ffffff";

/**
 * What a sheet's scrim lays over the window: black, deeper in Dark, where the
 * ground is near black or black and a light wash would show nothing.
 */
export const SCRIM = { light: "#00000026", dark: "#0000008c" } as const;

/** Words and glyphs on shiso (the agents' fill: the consent tile, the capsule, a badge). */
export const ON_AGENT = "#ffffff";
/** Words and glyphs on a decorative tint (TINTS: Settings' tiles, a letter tile, a calendar's colour). */
export const ON_TINT = "#ffffff";

/** "On" in a mode: the guard's `selection` under `onAccent` (R2, CO-1); every switch, tick, chosen pill and lit tile, in both kits. */
export interface OnColors {
  on: string;
  onInk: string;
}

/** The one "on" of a palette (useColors() carries the person's accent into it). */
export const onOf = (colors: Palette): OnColors => ({ on: colors.selection, onInk: colors.onAccent });

/**
 * Amber, "needs you" (SH-7): the agents' mark while something waits on the
 * person, the capsule's disc that asks, the Dock's ring. The fill, the ink
 * on it, and amber as a glyph or words on a light ground.
 */
export const AMBER = { fill: "#F0B93C", ink: "#1D1D1F", deep: "#86600A" } as const;

/** The screenshot area (SH-33): a white wash with a light edge, its size label on a dark chip. */
export const CAPTURE_AREA = { wash: "#ffffff26", edge: "#ffffffd9", labelGround: "#000000a6", labelInk: "#ffffff" } as const;

/** The lock screen's glass over the wallpaper (SH-27): the paper and the hairline of a widget on it. */
export const LOCK_GLASS = { paper: "#00000047", hairline: "#FFFFFF33" } as const;

/**
 * The login screen (Dark's look on the darkened wallpaper): its words, the
 * field and buttons as white washes, a button held, the initials' disc, and
 * a wrong password's words.
 */
export const LOGIN = {
  ground: `${TRUE_BLACK.ground}b8`,
  ink: TRUE_BLACK.ink,
  muted: `${TRUE_BLACK.ink}b3`,
  field: "#ffffff26",
  button: "#ffffff26",
  buttonHeld: "#ffffff59",
  initialsGround: "#ffffff2e",
  chip: "#ffffff1a",
  wrong: "#ffb4b4",
} as const;

/** Behind a picture shown full size (the Store's lightbox). */
export const MEDIA_SCRIM = "#000000cc";

/** The tile behind a terminal tool's icon (the Store): graphite in both modes. */
export const INK_TILE = "#1f1f1f";
