/**
 * What applets' controls last said, kept in
 * `$XDG_STATE_HOME/dashi/applet-controls.json` so a restart keeps it: the
 * file's place and how its text is read back (controls.ts keeps the rest).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { CONTROL_LIMITS } from "@dashi/applet";
import { isRecord } from "@dashi/shape";

/** What a control last said. */
export interface ControlState {
  on?: boolean;
  detail?: string | null;
  choice?: string;
  value?: number;
  glyph?: string;
}

export function controlStatePath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "applet-controls.json");
}

/** The kept states; anything that isn't one is left out. */
export function parseStates(text: string): Map<string, ControlState> {
  const out = new Map<string, ControlState>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith("applet:") || !isRecord(entry)) continue;
    const { on, detail, choice, value: number } = entry;
    out.set(key, {
      ...(typeof on === "boolean" ? { on } : {}),
      ...(typeof detail === "string" && detail.length <= CONTROL_LIMITS.detail ? { detail } : {}),
      ...(typeof choice === "string" && choice.length <= CONTROL_LIMITS.choice ? { choice } : {}),
      ...(typeof number === "number" && Number.isFinite(number) ? { value: number } : {}),
    });
  }
  return out;
}
