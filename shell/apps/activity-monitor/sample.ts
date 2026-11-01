/**
 * From two looks at the system (read.ts) to what Activity Monitor shows:
 * each process's share of the CPU over the interval, the machine's CPU
 * split, rates of disk and network traffic, and the short history the
 * graphs draw. Pure: the looks come in, rows and numbers go out.
 */

import type { CpuTimes, Counters, NetCounters } from "./proc.ts";
import type { ProcessSample, Snapshot } from "./read.ts";

export interface ProcessRow {
  pid: number;
  name: string;
  user: string;
  uid: number;
  /** Percent of one CPU over the last interval; above 100 when several threads run at once (as on the Mac). */
  cpu: number;
  /** CPU time used since it started, in seconds. */
  cpuTime: number;
  threads: number;
  memory: number;
  /** Bytes read and written; null when not ours to read. */
  read: number | null;
  written: number | null;
  sockets: number | null;
  kernel: boolean;
  /** The user's own: it may be quit. */
  own: boolean;
}

export interface RowContext {
  users: ReadonlyMap<number, string>;
  ownUid: number;
  clockTicks: number;
}

/** The same process in both looks: the same pid, started at the same moment. */
function sameProcess(a: ProcessSample | undefined, b: ProcessSample): a is ProcessSample {
  return a !== undefined && a.starttime === b.starttime;
}

export function processRows(prev: Snapshot | null, next: Snapshot, context: RowContext): ProcessRow[] {
  const seconds = prev ? (next.at - prev.at) / 1000 : 0;
  return [...next.processes.values()].map((sample) => {
    const before = prev?.processes.get(sample.pid);
    const ticks = sameProcess(before, sample) ? Math.max(0, sample.cpuTicks - before.cpuTicks) : 0;
    const cpu = seconds > 0 ? (ticks / context.clockTicks / seconds) * 100 : 0;
    return {
      pid: sample.pid,
      name: sample.name,
      user: context.users.get(sample.uid) ?? String(sample.uid),
      uid: sample.uid,
      cpu,
      cpuTime: sample.cpuTicks / context.clockTicks,
      threads: sample.threads,
      memory: sample.memory,
      read: sample.io?.read ?? null,
      written: sample.io?.written ?? null,
      sockets: sample.sockets,
      kernel: sample.kernel,
      own: sample.uid === context.ownUid,
    };
  });
}

export interface CpuSplit {
  /** Percent of all CPUs together. */
  user: number;
  system: number;
  idle: number;
}

const busy = (t: CpuTimes) => ({ user: t.user + t.nice, system: t.system + t.irq + t.softirq + t.steal, idle: t.idle + t.iowait });

export function cpuSplit(prev: CpuTimes, next: CpuTimes): CpuSplit {
  const a = busy(prev);
  const b = busy(next);
  const user = Math.max(0, b.user - a.user);
  const system = Math.max(0, b.system - a.system);
  const idle = Math.max(0, b.idle - a.idle);
  const total = user + system + idle;
  if (total === 0) return { user: 0, system: 0, idle: 100 };
  return { user: (user / total) * 100, system: (system / total) * 100, idle: (idle / total) * 100 };
}

/** Per-second rates between two sets of counters (a counter that went backwards, after a device left, is 0). */
export function rates<T extends Counters | NetCounters>(prev: T, next: T, seconds: number): T {
  const out = { ...next };
  for (const key of Object.keys(next) as Array<keyof T>) {
    const delta = (next[key] as number) - (prev[key] as number);
    (out[key] as number) = seconds > 0 ? Math.max(0, delta) / seconds : 0;
  }
  return out;
}

/** The graphs' points: the newest last, at most `length`. */
export function pushHistory(history: readonly number[], value: number, length = 60): number[] {
  const next = [...history, value];
  return next.length > length ? next.slice(next.length - length) : next;
}

/**
 * Rows a search keeps: the name contains it (any case), or it is the pid.
 * Kernel threads only when asked for; only one's own processes when `mine`.
 */
export function filterRows(rows: readonly ProcessRow[], query: string, scope: { mine: boolean; kernel: boolean }): ProcessRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (scope.kernel || !row.kernel) &&
      (!scope.mine || row.own) &&
      (q === "" || row.name.toLowerCase().includes(q) || String(row.pid) === q || row.user.toLowerCase() === q),
  );
}
