/**
 * Activity Monitor's live state: a look at /proc every two seconds (or as
 * often as View › Update Frequency says, or not at all while it is paused),
 * turned into rows and the summaries under the table, with a minute of
 * history for the graphs. A store with the usual subscribe/getSnapshot pair.
 * What the window needs decides what is read (io for Disk, sockets for
 * Network, wakeups and the GPU for Energy, kernel threads only when they are
 * shown).
 *
 * The look itself is asynchronous: in the app it runs on a worker thread
 * (sampler.ts), so reading /proc never holds up the window. One look is in
 * flight at a time; a refresh asked for meanwhile runs when it lands.
 *
 * `pause()` stops the timer while no one can see the window (main.tsx, the
 * kit's visibility signal, PA-15) and `resume()` starts it again with a
 * fresh look.
 */

import type { Counters, MemInfo, NetCounters } from "../../src/shared/processes/proc.ts";
import type { Snapshot } from "../../src/shared/processes/read.ts";
import { type CpuSplit, cpuSplit, type ProcessRow, processRows, pushHistory, type RowContext, rates, SMOOTHING } from "./sample.ts";
import type { LookWants } from "./sampler.ts";

export const INTERVAL_MS = 2000;
/** View › Update Frequency's choices; null is Paused. */
export const INTERVALS = [1000, 2000, 5000, null] as const;
/** Milliseconds between looks; null is paused. */
export type Interval = number | null;

export type Tab = "cpu" | "memory" | "energy" | "disk" | "network";

/** What one look reads, beyond what the reader knows by itself. */
export type LookOptions = LookWants;

export interface MonitorState {
  rows: ProcessRow[];
  cpu: CpuSplit;
  cpus: number;
  cpuHistory: { user: number[]; system: number[] };
  memory: MemInfo | null;
  /** Percent of memory in use. */
  memoryHistory: number[];
  /** The person's processes' energy impact added up, and its history. */
  energy: { impact: number; wakeups: number | null; gpu: number | null; history: number[] };
  disk: { totals: Counters; perSecond: Counters; history: { read: number[]; write: number[] } };
  net: { totals: NetCounters; perSecond: NetCounters; history: { in: number[]; out: number[] } };
}

const ZERO_DISK: Counters = { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 };
const ZERO_NET: NetCounters = { packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0 };

export const EMPTY: MonitorState = {
  rows: [],
  cpu: { user: 0, system: 0, idle: 100 },
  cpus: 1,
  cpuHistory: { user: [], system: [] },
  memory: null,
  memoryHistory: [],
  energy: { impact: 0, wakeups: null, gpu: null, history: [] },
  disk: { totals: ZERO_DISK, perSecond: ZERO_DISK, history: { read: [], write: [] } },
  net: { totals: ZERO_NET, perSecond: ZERO_NET, history: { in: [], out: [] } },
};

/** The person's own processes' energy, added up (what is known of it). */
export function energyTotals(rows: readonly ProcessRow[]): { impact: number; wakeups: number | null; gpu: number | null } {
  let impact = 0;
  let wakeups: number | null = null;
  let gpu: number | null = null;
  for (const row of rows) {
    if (!row.own || row.kernel) continue;
    impact += row.impact;
    if (row.wakeups !== null) wakeups = (wakeups ?? 0) + row.wakeups;
    if (row.gpu !== null) gpu = (gpu ?? 0) + row.gpu;
  }
  return { impact, wakeups, gpu };
}

/** The next state from the last one, the looks before (oldest first, empty on the first), and the newest. */
export function advance(state: MonitorState, earlier: readonly Snapshot[], next: Snapshot, context: RowContext): MonitorState {
  const prev = earlier.at(-1) ?? null;
  const rows = processRows(earlier, next, context);
  const seconds = prev ? (next.at - prev.at) / 1000 : 0;
  const cpu = prev?.cpu && next.cpu ? cpuSplit(prev.cpu.total, next.cpu.total) : state.cpu;
  const disk = prev ? rates(prev.disk, next.disk, seconds) : ZERO_DISK;
  const net = prev ? rates(prev.net, next.net, seconds) : ZERO_NET;
  const memory = next.memory;
  const used = memory && memory.total > 0 ? ((memory.total - memory.available) / memory.total) * 100 : 0;
  const first = prev === null;
  const energy = energyTotals(rows);
  return {
    rows,
    cpu,
    cpus: next.cpu?.cpus ?? state.cpus,
    cpuHistory: first ? state.cpuHistory : { user: pushHistory(state.cpuHistory.user, cpu.user), system: pushHistory(state.cpuHistory.system, cpu.system) },
    memory,
    memoryHistory: pushHistory(state.memoryHistory, used),
    energy: { ...energy, history: first ? state.energy.history : pushHistory(state.energy.history, energy.impact) },
    disk: {
      totals: next.disk,
      perSecond: disk,
      history: first
        ? state.disk.history
        : { read: pushHistory(state.disk.history.read, disk.readBytes), write: pushHistory(state.disk.history.write, disk.writeBytes) },
    },
    net: {
      totals: next.net,
      perSecond: net,
      history: first ? state.net.history : { in: pushHistory(state.net.history.in, net.bytesIn), out: pushHistory(state.net.history.out, net.bytesOut) },
    },
  };
}

export class Monitor {
  private state: MonitorState = EMPTY;
  /** The last looks, oldest first: what the next one is measured against. */
  private looks: Snapshot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tab: Tab = "cpu";
  private kernel = false;
  private inFlight = false;
  private again = false;
  /** Out of sight (main.tsx): no looks, whatever the interval. */
  private hidden = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly context: RowContext,
    private readonly look: (options: LookOptions) => Promise<Snapshot>,
    private interval: Interval = INTERVAL_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MonitorState => this.state;

  /** Reads now, then every `interval`; returns what stops it. */
  start(): () => void {
    this.resume();
    return () => this.pause();
  }

  /** No more looks until `resume`. */
  pause(): void {
    this.hidden = true;
    this.stopTimer();
  }

  /** Looks now and on the timer again (after a pause the last looks are stale, so they are dropped). */
  resume(): void {
    this.hidden = false;
    if (this.timer) return;
    this.looks = [];
    this.refresh();
    this.startTimer();
  }

  /** How often to look (View › Update Frequency); null stops until another is chosen. A look is taken at once. */
  setInterval(interval: Interval): void {
    if (interval === this.interval) return;
    this.interval = interval;
    this.stopTimer();
    if (this.hidden || interval === null) return;
    this.looks = [];
    this.refresh();
    this.startTimer();
  }

  /** The open tab; switching reads at once so its columns fill without waiting. */
  setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    if (tab === "disk" || tab === "network" || tab === "energy") this.refresh();
  }

  /** Whether kernel threads are shown (and so read). */
  setKernel(shown: boolean): void {
    if (shown === this.kernel) return;
    this.kernel = shown;
    this.refresh();
  }

  /** Takes a look; resolves once it has been applied (or, when one was in flight, once that one has). */
  refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return Promise.resolve();
    }
    this.inFlight = true;
    const options: LookOptions = { io: this.tab === "disk", sockets: this.tab === "network", kernel: this.kernel, energy: this.tab === "energy" };
    return this.look(options)
      .then((next) => {
        this.state = advance(this.state, this.looks, next, this.context);
        this.looks = [...this.looks, next].slice(-SMOOTHING);
        for (const listener of this.listeners) listener();
      })
      .catch(() => {
        // A failed look is skipped; the next tick tries again.
      })
      .finally(() => {
        this.inFlight = false;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
  }

  private startTimer(): void {
    if (this.interval === null || this.timer) return;
    this.timer = setInterval(() => this.refresh(), this.interval);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
