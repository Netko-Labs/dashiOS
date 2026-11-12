/** Captions in step with the speech: a sentence shows as its first sound plays, and each word is said at its own time, by the shell's clock. */

import type { Timers } from "../../shared/time/index.ts";
import type { Chip } from "../types.ts";
import type { SpokenWord } from "./wire.ts";

export class Captions {
  private pending: unknown[] = [];

  constructor(
    private readonly timers: Timers,
    private readonly show: (chip: Chip) => void,
  ) {}

  /** A sentence's first sound plays now. */
  sentence(text: string, words: readonly SpokenWord[]): void {
    this.clear();
    const said = words.length > 0 ? words.map((word) => word.text) : text.split(/\s+/).filter(Boolean);
    const at = (index: number): void => this.show({ kind: "speaking", words: said, at: index, full: text });
    at(-1);
    words.forEach((word, index) => {
      this.pending.push(this.timers.set(() => at(index), Math.max(0, word.start)));
    });
  }

  clear(): void {
    for (const timer of this.pending) this.timers.clear(timer);
    this.pending = [];
  }
}

/** The microphone's loudness while listening, 0 to 1: its own store, so 31 levels a second redraw the meter and nothing else. */
export class LevelStore {
  private level = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.level;

  set(level: number): void {
    const next = Math.min(1, Math.max(0, level));
    if (next === this.level) return;
    this.level = next;
    for (const listener of [...this.listeners]) listener();
  }
}
