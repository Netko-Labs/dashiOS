/**
 * The colours the palette was missing (docs/design.html CO-5): names for what
 * modules wrote as hex. No hex outside theme/ (H21): "no fill" is CLEAR,
 * words on a fill are onAccent, onPrimary, onAgent or onTint, never a loose
 * white, and each fixed set a module used to keep lives here, checked by
 * contrast.test.ts.
 */

import { INK_PAPER, INK_TEXT } from "./inks.ts";
import { darkColors, lightColors, type Palette, TRUE_BLACK } from "./palette.ts";

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

/** The screenshot area (SH-33, GL-6): black at 35 % outside it, clear inside, a light edge, its words on dark chips; never glass. */
export const CAPTURE_AREA = { outside: "#00000059", edge: "#ffffffd9", labelGround: "#000000a6", labelInk: "#ffffff" } as const;

/**
 * The login screen's and the lock's words and controls over the wallpaper:
 * its ground (the wallpaper darkened, or lightened), the ink and 70% of it,
 * the field (its edge the focus ring while it has the keyboard, KB-2), the power buttons and one held, the initials' disc, the session
 * chip, a wrong password's words (the mode's criticalInk) and the ring.
 */
export interface LoginColors {
  ground: string;
  ink: string;
  muted: string;
  field: string;
  button: string;
  buttonHeld: string;
  initialsGround: string;
  chip: string;
  wrong: string;
  focusRing: string;
  /** A glyph on an ink fill (the field's go arrow). */
  onInk: string;
}

/** The login screen (always: nobody has signed in to choose) and the lock in Dark: the wallpaper darkened to 72% black. */
export const LOGIN: LoginColors = {
  ground: `${TRUE_BLACK.ground}b8`,
  ink: TRUE_BLACK.ink,
  muted: `${TRUE_BLACK.ink}b3`,
  field: "#ffffff26",
  button: "#ffffff26",
  buttonHeld: "#ffffff59",
  initialsGround: "#ffffff2e",
  chip: "#ffffff1a",
  wrong: darkColors.criticalInk,
  focusRing: darkColors.focusRing,
  onInk: darkColors.onPrimary,
};

/**
 * The lock in Light (inks frame 5): the wallpaper lightened to 82% paper
 * under Light's ink, so its words read on any wallpaper as Dark's do; its
 * washes are the ink's.
 */
export const LOGIN_LIGHT: LoginColors = {
  ground: `${INK_PAPER.light}d0`,
  ink: INK_TEXT.light.ink,
  muted: `${INK_TEXT.light.ink}b3`,
  field: `${INK_TEXT.light.ink}1a`,
  button: `${INK_TEXT.light.ink}1a`,
  buttonHeld: `${INK_TEXT.light.ink}40`,
  initialsGround: `${INK_TEXT.light.ink}24`,
  chip: `${INK_TEXT.light.ink}14`,
  wrong: lightColors.criticalInk,
  focusRing: lightColors.focusRing,
  onInk: lightColors.onPrimary,
};

/** The set for a mode: the login screen asks for "dark" always, the lock for the person's mode. */
export const loginColors = (mode: "light" | "dark"): LoginColors => (mode === "light" ? LOGIN_LIGHT : LOGIN);

/** Behind a picture shown full size (the Store's lightbox). */
export const MEDIA_SCRIM = "#000000cc";

/** The tile behind a terminal tool's icon (the Store): graphite in both modes. */
export const INK_TILE = "#1f1f1f";
