/**
 * Activity Monitor's live state: a look at /proc every two seconds, turned
 * into rows and the summaries under the table, with a minute of history for
 * the graphs. A store with the usual subscribe/getSnapshot pair. What the
 * open tab needs decides what is read (io for Disk, sockets for Network).
 */

import type { Counters, MemInfo, NetCounters } from "./proc.ts";
import { readSnapshot, type ReadOptions, type Snapshot } from "./read.ts";
import { type CpuSplit, cpuSplit, type ProcessRow, processRows, pushHistory, rates, type RowContext } from "./sample.ts";

export const INTERVAL_MS = 2000;

export type Tab = "cpu" | "memory" | "disk" | "network";

export interface MonitorState {
  rows: ProcessRow[];
  cpu: CpuSplit;
  cpus: number;
  cpuHistory: { user: number[]; system: number[] };
  memory: MemInfo | null;
  /** Percent of memory in use. */
  memoryHistory: number[];
  disk: { totals: Counters; perSecond: Counters; history: { read: number[]; write: number[] } };
  net: { totals: NetCounters; perSecond: NetCounters; history: { in: number[]; out: number[] } };
  threads: number;
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
  disk: { totals: ZERO_DISK, perSecond: ZERO_DISK, history: { read: [], write: [] } },
  net: { totals: ZERO_NET, perSecond: ZERO_NET, history: { in: [], out: [] } },
  threads: 0,
};

/** The next state from the last one and two looks (`prev` null on the first). */
export function advance(state: MonitorState, prev: Snapshot | null, next: Snapshot, context: RowContext): MonitorState {
  const rows = processRows(prev, next, context);
  const seconds = prev ? (next.at - prev.at) / 1000 : 0;
  const cpu = prev?.cpu && next.cpu ? cpuSplit(prev.cpu.total, next.cpu.total) : state.cpu;
  const disk = prev ? rates(prev.disk, next.disk, seconds) : ZERO_DISK;
  const net = prev ? rates(prev.net, next.net, seconds) : ZERO_NET;
  const memory = next.memory;
  const used = memory && memory.total > 0 ? ((memory.total - memory.available) / memory.total) * 100 : 0;
  const first = prev === null;
  return {
    rows,
    cpu,
    cpus: next.cpu?.cpus ?? state.cpus,
    cpuHistory: first ? state.cpuHistory : { user: pushHistory(state.cpuHistory.user, cpu.user), system: pushHistory(state.cpuHistory.system, cpu.system) },
    memory,
    memoryHistory: pushHistory(state.memoryHistory, used),
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
    threads: rows.reduce((sum, row) => sum + row.threads, 0),
  };
}

export class Monitor {
  private state: MonitorState = EMPTY;
  private last: Snapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private tab: Tab = "cpu";
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly context: RowContext,
    private readonly read: Omit<ReadOptions, "io" | "sockets">,
    private readonly look: (options: ReadOptions) => Snapshot = readSnapshot,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MonitorState => this.state;

  /** Reads now, then every `INTERVAL_MS`. */
  start(): () => void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), INTERVAL_MS);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    };
  }

  /** The open tab; switching reads at once so its columns fill without waiting. */
  setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    if (tab === "disk" || tab === "network") this.refresh();
  }

  refresh(): void {
    const next = this.look({ ...this.read, io: this.tab === "disk", sockets: this.tab === "network" });
    this.state = advance(this.state, this.last, next, this.context);
    this.last = next;
    for (const listener of this.listeners) listener();
  }
}
