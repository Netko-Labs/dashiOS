/**
 * The Sound pane's two volumes (the default output and the default input) as
 * a store: read when the pane opens, then following PipeWire while it is up
 * (the volume keys, or `wpctl`, move the output while the pane is showing;
 * every few seconds' read only where PipeWire can't be watched), and changed
 * with the sliders. A change shows at once and the system is read back.
 */

import { useSyncExternalStore } from "react";
import type { Volume } from "../system/volume.ts";
import { VolumeFollow } from "../system/volume-follow.ts";
import type { Levels, SideVolumes } from "./levels.ts";
import type { Side } from "./lib/parse-dump.ts";

export type LevelsState = SideVolumes;

export const LEVELS_POLL_MS = 3000;

export class LevelsStore {
  private snapshot: LevelsState = { output: null, input: null };
  private readonly listeners = new Set<() => void>();
  private reads = 0;
  private writing = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopFollow: (() => void) | null = null;
  /** PipeWire's word per side, held a moment after a slider set it. */
  private readonly follows: Record<Side, VolumeFollow> = {
    output: new VolumeFollow((volume) => this.heard("output", volume)),
    input: new VolumeFollow((volume) => this.heard("input", volume)),
  };

  constructor(
    private readonly levels: Levels,
    /** The output level changed here: the menu bar's glyph should follow. */
    private readonly outputChanged?: (volume: Volume) => void,
    private readonly pollMs: number = LEVELS_POLL_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LevelsState => this.snapshot;

  open(): void {
    const { follow } = this.levels;
    if (follow) {
      this.stopFollow ??= follow((levels) => {
        this.follows.output.heard(levels.output);
        this.follows.input.heard(levels.input);
      });
    } else {
      this.timer ??= setInterval(() => void this.refresh(), this.pollMs);
    }
    void this.refresh();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.stopFollow?.();
    this.stopFollow = null;
    this.follows.output.stop();
    this.follows.input.stop();
  }

  /** PipeWire's word for one side (past the hold). */
  private heard(side: Side, volume: Volume | null): void {
    // A read still running started before this change.
    this.reads++;
    this.publish({ [side]: volume });
  }

  async refresh(): Promise<void> {
    // A read that started before a change, or while one is being made, would put the old value back.
    if (this.writing > 0) return;
    const read = ++this.reads;
    const [output, input] = await Promise.all([this.levels.read("output").catch(() => null), this.levels.read("input").catch(() => null)]);
    if (read !== this.reads || this.writing > 0) return;
    this.publish({ output, input });
  }

  setLevel(side: Side, level: number): Promise<void> {
    const current = this.snapshot[side];
    if (!current) return Promise.resolve();
    const clamped = Math.min(Math.max(level, 0), 1);
    return this.write(side, { level: clamped, muted: clamped > 0 ? false : current.muted }, () => this.levels.setLevel(side, clamped));
  }

  setMuted(side: Side, muted: boolean): Promise<void> {
    const current = this.snapshot[side];
    if (!current) return Promise.resolve();
    return this.write(side, { ...current, muted }, () => this.levels.setMuted(side, muted));
  }

  private async write(side: Side, shown: Volume, work: () => Promise<Volume | null>): Promise<void> {
    this.writing++;
    this.reads++;
    this.follows[side].set(shown);
    this.publish({ [side]: shown });
    let truth: Volume | null = null;
    try {
      truth = await work();
    } catch {
      truth = null;
    }
    this.writing--;
    if (truth) {
      this.follows[side].set(truth);
      this.publish({ [side]: truth });
      if (side === "output") this.outputChanged?.(truth);
    } else {
      await this.refresh();
    }
  }

  private publish(change: Partial<LevelsState>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useLevels(store: LevelsStore): LevelsState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
