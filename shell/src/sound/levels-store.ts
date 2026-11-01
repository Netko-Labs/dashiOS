/**
 * The Sound pane's two volumes (the default output and the default input) as
 * a store: read when the pane opens and every few seconds while it is up (the
 * volume keys move the output while the pane is showing), and changed with
 * the sliders. A change shows at once and the system is read back.
 */

import { useSyncExternalStore } from "react";
import type { Volume } from "../system/volume.ts";
import type { Levels } from "./levels.ts";
import type { Side } from "./parse-dump.ts";

export interface LevelsState {
  /** Null without PipeWire or a default device on that side. */
  output: Volume | null;
  input: Volume | null;
}

export const LEVELS_POLL_MS = 3000;

export class LevelsStore {
  private snapshot: LevelsState = { output: null, input: null };
  private readonly listeners = new Set<() => void>();
  private reads = 0;
  private writing = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

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
    this.timer ??= setInterval(() => void this.refresh(), this.pollMs);
    void this.refresh();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
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
    this.publish({ [side]: shown });
    let truth: Volume | null = null;
    try {
      truth = await work();
    } catch {
      truth = null;
    }
    this.writing--;
    if (truth) {
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
