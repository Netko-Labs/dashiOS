/**
 * Volume and mute through PipeWire's `wpctl`, on the default output (and the
 * default microphone for the mic key). Steps are 1/16, like the Mac's.
 */

import type { Run } from "./exec.ts";

export const SINK = "@DEFAULT_AUDIO_SINK@";
export const SOURCE = "@DEFAULT_AUDIO_SOURCE@";

/** One step of the volume keys: a sixteenth, as the OSD's 16 segments. */
export const STEP_PERCENT = 6.25;

export interface Volume {
  /** 0 to 1 is the normal range; PipeWire allows more. */
  level: number;
  muted: boolean;
}

/** `Volume: 0.40` or `Volume: 0.40 [MUTED]`, as `wpctl get-volume` prints it. */
export function parseVolume(output: string): Volume | null {
  const match = /^Volume: (\d+(?:\.\d+)?)( \[MUTED\])?$/.exec(output.trim());
  if (!match?.[1]) return null;
  const level = Number(match[1]);
  return Number.isFinite(level) ? { level, muted: match[2] !== undefined } : null;
}

export async function readVolume(run: Run, target: string = SINK): Promise<Volume | null> {
  const output = await run(["wpctl", "get-volume", target]);
  return output === null ? null : parseVolume(output);
}

/** Louder or quieter by a step, never past 100%; raising it also unmutes. */
export async function stepVolume(run: Run, direction: "up" | "down"): Promise<Volume | null> {
  const before = await readVolume(run);
  if (before === null) return null;
  if (direction === "up" && before.muted) await run(["wpctl", "set-mute", SINK, "0"]);
  const change = `${STEP_PERCENT}%${direction === "up" ? "+" : "-"}`;
  await run(["wpctl", "set-volume", "-l", "1.0", SINK, change]);
  return readVolume(run);
}

/** What a step makes of `before`, without asking PipeWire: a development run's keys (keys.ts). */
export function stepped(before: Volume, direction: "up" | "down"): Volume {
  const level = Math.min(Math.max(before.level + (direction === "up" ? STEP_PERCENT : -STEP_PERCENT) / 100, 0), 1);
  return { level, muted: direction === "up" ? false : before.muted };
}

export async function toggleMute(run: Run, target: string = SINK): Promise<Volume | null> {
  if ((await run(["wpctl", "set-mute", target, "toggle"])) === null) return null;
  return readVolume(run, target);
}

/** Sets the output volume to `level` (0 to 1), as Control Center's slider does; raising it unmutes. */
export async function setVolume(run: Run, level: number, unmute: boolean): Promise<Volume | null> {
  const clamped = Math.min(Math.max(level, 0), 1);
  if (unmute && clamped > 0) await run(["wpctl", "set-mute", SINK, "0"]);
  await run(["wpctl", "set-volume", "-l", "1.0", SINK, clamped.toFixed(2)]);
  return readVolume(run);
}
