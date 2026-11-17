/**
 * The tally: one holder for the whole system (round three's idea, round
 * five's rules). Sources (timers, the calendar, music, agents' runs and
 * questions, downloads) say what is live; the store decides who is on air
 * by rule (lib/rules.ts), and the bar, the notification area, the lock
 * screen and Glance all read the same answer. Time comes in from outside
 * (`clock`, `schedule`), so the rules are tested without waiting.
 */

import { decide, EMPTY_TALLY, houseDown, nextChange, type TallyState } from "./lib/rules.ts";
import { type OnAirItem, TALLY_RULES, type TallyView } from "./types.ts";

export interface TallyClock {
  now(): number;
  /** Run `run` at `at` (ms); returns a cancel. */
  at(at: number, run: () => void): () => void;
}

export const REAL_CLOCK: TallyClock = {
  now: () => Date.now(),
  at: (at, run) => {
    const handle = setTimeout(run, Math.max(0, at - Date.now()));
    return () => clearTimeout(handle);
  },
};

const NOTHING: TallyView = { holder: null, item: null, standby: [], houseDown: false, pinned: null };

export class TallyStore {
  private readonly sources = new Map<string, readonly OnAirItem[]>();
  private state: TallyState = EMPTY_TALLY;
  private view: TallyView = NOTHING;
  private readonly listeners = new Set<() => void>();
  private cancelWake: (() => void) | null = null;

  constructor(private readonly clock: TallyClock = REAL_CLOCK) {}

  /** What one source has live now (replaces what it said before); an empty list takes it off. */
  set(source: string, items: readonly OnAirItem[]): void {
    if (items.length === 0) this.sources.delete(source);
    else this.sources.set(source, items);
    this.run();
  }

  /** A long press on a live item: it holds until it ends; asking still beats it, and it comes back after. */
  pin(key: string | null): void {
    const now = this.clock.now();
    // The person's own act is not held back by the minute's hold.
    this.state = { ...this.state, pinned: key, heldSince: key === null ? this.state.heldSince : now - TALLY_RULES.holdMs };
    this.run();
  }

  get(): TallyView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private items(): OnAirItem[] {
    return [...this.sources.values()].flat();
  }

  private run(): void {
    const now = this.clock.now();
    const items = this.items();
    this.state = decide(this.state, items, now);
    this.publish(items, now);
    this.cancelWake?.();
    const wake = nextChange(this.state, now);
    this.cancelWake = wake === null ? null : this.clock.at(wake, () => this.run());
  }

  private publish(items: readonly OnAirItem[], now: number): void {
    const item = items.find((candidate) => candidate.key === this.state.holder) ?? null;
    const standby = items.filter((candidate) => candidate !== item && !this.state.spent.includes(candidate.key)).sort((a, b) => b.since - a.since);
    const next: TallyView = { holder: item?.key ?? null, item, standby, houseDown: houseDown(this.state, now), pinned: this.state.pinned };
    if (same(next, this.view)) return;
    this.view = next;
    for (const listener of this.listeners) listener();
  }
}

function same(a: TallyView, b: TallyView): boolean {
  return (
    a.holder === b.holder &&
    a.item === b.item &&
    a.houseDown === b.houseDown &&
    a.pinned === b.pinned &&
    a.standby.length === b.standby.length &&
    a.standby.every((item, i) => item === b.standby[i])
  );
}

let system: TallyStore | null = null;

/** The one tally for the whole shell: the bar, the area, the lock screen and Glance read it. */
export function systemTally(): TallyStore {
  system ??= new TallyStore();
  return system;
}
