/**
 * Volume and mute for the default output and the default input (the
 * microphone), through `wpctl`. Settings' Sound pane has a slider for each.
 * On a development run the levels are read from the host but a change is only
 * remembered, never made on the developer's machine (the same rule as the
 * default device, `backend.ts`).
 */

import { run as defaultRun, type Run } from "../system/exec.ts";
import { readVolume, SINK, SOURCE, type Volume } from "../system/volume.ts";
import type { Side } from "./parse-dump.ts";

export interface Levels {
  /** Null without PipeWire. */
  read(side: Side): Promise<Volume | null>;
  /** Sets the level (0 to 1); a change from silence also unmutes. Resolves with what is set now. */
  setLevel(side: Side, level: number): Promise<Volume | null>;
  setMuted(side: Side, muted: boolean): Promise<Volume | null>;
}

const TARGET: Record<Side, string> = { output: SINK, input: SOURCE };

export function wpctlLevels(run: Run = defaultRun): Levels {
  return {
    read: (side) => readVolume(run, TARGET[side]),
    setLevel: async (side, level) => {
      const clamped = Math.min(Math.max(level, 0), 1);
      if (clamped > 0) await run(["wpctl", "set-mute", TARGET[side], "0"]);
      await run(["wpctl", "set-volume", "-l", "1.0", TARGET[side], clamped.toFixed(2)]);
      return readVolume(run, TARGET[side]);
    },
    setMuted: async (side, muted) => {
      await run(["wpctl", "set-mute", TARGET[side], muted ? "1" : "0"]);
      return readVolume(run, TARGET[side]);
    },
  };
}

export function shadowLevels(real: Levels): Levels {
  const told: Record<Side, Volume | null> = { output: null, input: null };
  return {
    read: async (side) => told[side] ?? (await real.read(side)),
    setLevel: async (side, level) => {
      const before = told[side] ?? (await real.read(side));
      if (before === null) return null;
      const clamped = Math.min(Math.max(level, 0), 1);
      told[side] = { level: clamped, muted: clamped > 0 ? false : before.muted };
      return told[side];
    },
    setMuted: async (side, muted) => {
      const before = told[side] ?? (await real.read(side));
      if (before === null) return null;
      told[side] = { ...before, muted };
      return told[side];
    },
  };
}
