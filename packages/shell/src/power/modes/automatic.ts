/**
 * Which mode is in effect, and why, in one line for the battery menu.
 *
 * Automatic follows the power source and the battery: High Performance
 * plugged in, Balanced on battery, Low Power below 20% (Balanced on a
 * machine without a battery). A manual pick wins
 * over it. A key press (Fn F5, or another program changing the mode) while
 * Automatic is chosen holds that mode until the cable changes, when
 * Automatic takes over again; the column (plugged in or on battery) always
 * follows the cable.
 */

import { type Column, MODE_LABEL, type Mode, type ModeChoice } from "./types.ts";

/** Below this charge, on battery, Automatic picks Low Power. */
export const LOW_BATTERY = 20;

export interface PowerSource {
  /** On a charger (charging, full, or held at a limit); a machine without a battery counts as plugged in. */
  plugged: boolean;
  /** Null without a battery. */
  percent: number | null;
}

export interface Effective {
  mode: Mode;
  column: Column;
  /** Automatic is choosing (no manual pick, no key press holding a mode). */
  automatic: boolean;
  /** What Automatic chose and why, or what holds the mode; one line. */
  why: string;
}

/** Automatic's own pick. */
export function automaticMode(source: PowerSource): { mode: Mode; why: string } {
  // A desktop is always plugged in; Balanced is its everyday mode, as it is tuned's.
  if (source.percent === null) return { mode: "balanced", why: "no battery" };
  if (source.plugged) return { mode: "performance", why: "plugged in" };
  if (source.percent !== null && source.percent < LOW_BATTERY) return { mode: "low-power", why: `battery below ${LOW_BATTERY}%` };
  return { mode: "balanced", why: "on battery" };
}

export function columnOf(source: PowerSource): Column {
  return source.plugged ? "plugged" : "battery";
}

/** The mode in effect for `choice`, a key press's `held` mode (null for none), and the power source. */
export function effectiveMode(choice: ModeChoice, held: Mode | null, source: PowerSource): Effective {
  const column = columnOf(source);
  if (choice !== "automatic") return { mode: choice, column, automatic: false, why: `${MODE_LABEL[choice]}, chosen by you` };
  if (held !== null) return { mode: held, column, automatic: false, why: `${MODE_LABEL[held]} from the keyboard, until the power source changes` };
  const pick = automaticMode(source);
  return { mode: pick.mode, column, automatic: true, why: `Automatic chose ${MODE_LABEL[pick.mode]}: ${pick.why}` };
}
