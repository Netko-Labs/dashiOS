/**
 * Dashi's power mode on the applets channel (protocol 4, docs/applets.md
 * "Version 4: the power mode"): an applet with the `power.mode` permission
 * reads the person's choice (Automatic or a mode), what is in effect and
 * why, and asks for another choice. The mode stays Dashi's: the applet asks,
 * the shell's mode store decides and applies, exactly as for a pick in
 * Control Center or Settings.
 *
 *   shell → applet  {"type":"power","choice":"automatic","available":["low-power","balanced","performance"],
 *                    "mode":"performance","automatic":true,"why":"Automatic chose High Performance: plugged in","failed":false}
 *   applet → shell  {"type":"power","choice":"low-power"}
 *
 * The shell sends the state right after its welcome and again on every
 * change. `mode` and `why` are null until the power source is known;
 * `available` is empty on a machine without modes.
 */

import { isRefusal, type Refusal, record, refuse } from "@dashi/shape/kit";

/** The protocol that brings it. */
export const POWER_PROTOCOL = 4;

export const POWER_MODES = ["low-power", "balanced", "performance"] as const;
export type PowerMode = (typeof POWER_MODES)[number];
export type PowerChoice = PowerMode | "automatic";

export const isPowerMode = (value: unknown): value is PowerMode => POWER_MODES.some((mode) => mode === value);
export const isPowerChoice = (value: unknown): value is PowerChoice => value === "automatic" || isPowerMode(value);

/** What the shell says about the power mode. */
export interface PowerState {
  /** The person's choice: Automatic, or a mode they picked. */
  choice: PowerChoice;
  /** The modes this machine has, in order; empty without any. */
  available: PowerMode[];
  /** The mode in effect; null until the power source is known. */
  mode: PowerMode | null;
  /** Automatic is choosing now (no pick, no key press holding a mode). */
  automatic: boolean;
  /** What is in effect and why, one line, as Settings shows it ("Automatic chose High Performance: plugged in"). */
  why: string | null;
  /** The last switch didn't go through everywhere. */
  failed: boolean;
}

/** Characters in `why`. */
const WHY_LIMIT = 200;

/** An applet's ask: `{"type":"power","choice"}`. */
export function parsePowerAsk(raw: Record<string, unknown>): { type: "power"; choice: PowerChoice } | Refusal {
  const fields = record(raw, "power", ["type", "choice"]);
  if (isRefusal(fields)) return fields;
  if (!isPowerChoice(fields.choice)) return refuse(`power: choice must be "automatic", ${POWER_MODES.map((mode) => `"${mode}"`).join(", ")}`);
  return { type: "power", choice: fields.choice };
}

/** The shell's state (the applet's side); null for anything it can't read, so a newer shell's fields are skipped, not trusted. */
export function parsePowerState(fields: Record<string, unknown>): PowerState | null {
  const { choice, available, mode, automatic, why, failed } = fields;
  if (!isPowerChoice(choice) || !Array.isArray(available) || !available.every(isPowerMode)) return null;
  if (mode !== null && !isPowerMode(mode)) return null;
  if (typeof automatic !== "boolean" || typeof failed !== "boolean") return null;
  if (why !== null && (typeof why !== "string" || why.length > WHY_LIMIT)) return null;
  return { choice, available: POWER_MODES.filter((each) => available.includes(each)), mode, automatic, why, failed };
}
