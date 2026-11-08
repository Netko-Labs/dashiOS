/**
 * Dashi's power modes: three, to match the firmware's Fn F5 steps, plus
 * Automatic, which picks one of them. Each mode is a recipe with two
 * columns: plugged in and on battery (the cable switches columns, not modes).
 */

import type { KnobValue } from "../../hardware/describe.ts";
import type { ProfileId } from "../../system/profiles.ts";

export const MODES = ["low-power", "balanced", "performance"] as const;
export type Mode = (typeof MODES)[number];
export type ModeChoice = Mode | "automatic";
export type Column = "plugged" | "battery";

export const isMode = (value: unknown): value is Mode => MODES.some((mode) => mode === value);
export const isModeChoice = (value: unknown): value is ModeChoice => value === "automatic" || isMode(value);

export const MODE_LABEL: Readonly<Record<Mode, string>> = { "low-power": "Low Power", balanced: "Balanced", performance: "High Performance" };
/** The short words a tile or a segmented control has room for. */
export const MODE_SHORT: Readonly<Record<Mode, string>> = { "low-power": "Low", balanced: "Balanced", performance: "High" };

/** tuned-ppd's profile for each mode, and back. */
export const MODE_PROFILE: Readonly<Record<Mode, ProfileId>> = { "low-power": "power-saver", balanced: "balanced", performance: "performance" };
export const modeOfProfile = (profile: ProfileId): Mode => (profile === "power-saver" ? "low-power" : profile);

/** One column of a recipe: knob values (docs/hardware.md, Knobs). The screen's refresh rate is Displays' (display-config/auto-refresh.ts). */
export interface Recipe {
  knobs: Readonly<Record<string, KnobValue>>;
}

export type Recipes = Readonly<Record<Mode, Readonly<Record<Column, Recipe>>>>;

/** The next mode Fn F5 (or the tile's click) steps to. */
export function nextMode(mode: Mode): Mode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length] as Mode;
}
