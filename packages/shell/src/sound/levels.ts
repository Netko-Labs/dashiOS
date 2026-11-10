/**
 * Volume and mute for the default output and the default input (the
 * microphone), through `wpctl`, followed through the session's
 * `pw-dump --monitor` (apps/watch.ts). Settings' Sound pane has a slider for
 * each.
 * On a development run the levels are read from the host but a change is only
 * remembered, never made on the developer's machine (the same rule as the
 * default device, `backend.ts`).
 */

import { run as defaultRun, type Run } from "../system/exec.ts";
import { readVolume, SINK, SOURCE, type Volume } from "../system/volume.ts";
import type { PipeWireWatch } from "./apps/watch.ts";
import { defaultVolume, type Side } from "./parse-dump.ts";

/** The default output's and input's volumes. */
export interface SideVolumes {
  /** Null without PipeWire or a default device on that side. */
  output: Volume | null;
  input: Volume | null;
}

export interface Levels {
  /** Null without PipeWire. */
  read(side: Side): Promise<Volume | null>;
  /** Sets the level (0 to 1); a change from silence also unmutes. Resolves with what is set now. */
  setLevel(side: Side, level: number): Promise<Volume | null>;
  setMuted(side: Side, muted: boolean): Promise<Volume | null>;
  /** Tells both volumes each time PipeWire changes (apps/watch.ts), so nothing polls; absent where PipeWire can't be watched. Returns the stop. */
  follow?(onLevels: (levels: SideVolumes) => void): () => void;
}

/** Hears the default output's volume each time it changes; returns the stop. */
export type FollowVolume = (onVolume: (volume: Volume | null) => void) => () => void;

/** The default output's volume as PipeWire changes it: for the menu bar's speaker and Control Center's slider. */
export const followOutputVolume =
  (watch: PipeWireWatch): FollowVolume =>
  (onVolume) =>
    watch.subscribe((objects) => onVolume(defaultVolume(objects, "output")));

/** Both volumes from PipeWire's objects, as `wpctl get-volume` reads them. */
export const volumesFrom = (objects: readonly unknown[]): SideVolumes => ({
  output: defaultVolume(objects, "output"),
  input: defaultVolume(objects, "input"),
});

const TARGET: Record<Side, string> = { output: SINK, input: SOURCE };

export function wpctlLevels(run: Run = defaultRun, watch?: PipeWireWatch): Levels {
  return {
    ...(watch?.available ? { follow: (onLevels: (levels: SideVolumes) => void) => watch.subscribe((objects) => onLevels(volumesFrom(objects))) } : {}),
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
  const { follow } = real;
  return {
    // The host's changes are followed; a side set here keeps what was set.
    ...(follow
      ? {
          follow: (onLevels: (levels: SideVolumes) => void) =>
            follow((levels) => onLevels({ output: told.output ?? levels.output, input: told.input ?? levels.input })),
        }
      : {}),
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
