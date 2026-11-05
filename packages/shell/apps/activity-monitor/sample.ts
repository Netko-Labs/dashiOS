/**
 * From looks at the system (read.ts) to what Activity Monitor shows: each
 * process's share of the CPU, smoothed over the last few looks, its disk
 * traffic per second, the machine's CPU split, rates of disk and network
 * traffic, and the short history the graphs draw. Pure: the looks come in,
 * rows and numbers go out.
 */

import type { Counters, CpuTimes, NetCounters } from "./proc.ts";
import type { ProcessSample, Snapshot } from "./read.ts";

/** Looks a process's % CPU is averaged over (with the newest): about six seconds at the two-second interval. */
export const SMOOTHING = 3;

export interface ProcessRow {
  pid: number;
  name: string;
  user: string;
  uid: number;
  /**
   * Percent of one CPU core, averaged over the last `SMOOTHING` intervals (or
   * since it started); above 100 when several threads run at once.
   */
  cpu: number;
  /** CPU time used since it started, in seconds. */
  cpuTime: number;
  threads: number;
  /** The memory that is its own (RssAnon + RssShmem), in bytes. */
  memory: number;
  /** Bytes read and written since it started; null when not ours to read. */
  read: number | null;
  written: number | null;
  /** Bytes read and written per second over the last interval; null when not ours to read, or on the first look. */
  readRate: number | null;
  writeRate: number | null;
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

/** A counter's change per second between two looks; null when either side lacks it. */
function perSecond(before: number | undefined, after: number | undefined, seconds: number): number | null {
  if (before === undefined || after === undefined || seconds <= 0) return null;
  return Math.max(0, after - before) / seconds;
}

/**
 * The rows for the newest look, `next`, against the looks before it
 * (`earlier`, oldest first; at most the last `SMOOTHING` are used). % CPU is
 * the CPU time used since the oldest of them that saw the same process,
 * over the time between: an average, so one clock tick in one interval no
 * longer reads as a jump. Disk rates are over the last interval only.
 */
export function processRows(earlier: readonly Snapshot[], next: Snapshot, context: RowContext): ProcessRow[] {
  const window = earlier.slice(-SMOOTHING);
  const prev = window.at(-1);
  const ioSeconds = prev ? (next.at - prev.at) / 1000 : 0;
  return [...next.processes.values()].map((sample) => {
    const since = window.find((look) => sameProcess(look.processes.get(sample.pid), sample));
    const before = since?.processes.get(sample.pid);
    const seconds = since ? (next.at - since.at) / 1000 : 0;
    const ticks = before ? Math.max(0, sample.cpuTicks - before.cpuTicks) : 0;
    const cpu = seconds > 0 ? (ticks / context.clockTicks / seconds) * 100 : 0;
    const last = prev?.processes.get(sample.pid);
    const lastIo = last && sameProcess(last, sample) ? last.io : null;
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
      readRate: perSecond(lastIo?.read, sample.io?.read, ioSeconds),
      writeRate: perSecond(lastIo?.written, sample.io?.written, ioSeconds),
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

// Steal (time a hypervisor gave to another guest) is neither this machine's work nor its idle: it is left out.
const busy = (t: CpuTimes) => ({ user: t.user + t.nice, system: t.system + t.irq + t.softirq, idle: t.idle + t.iowait });

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

export interface Scope {
  /** Only the user's own processes. */
  mine: boolean;
  /** Kernel threads shown. */
  kernel: boolean;
}

/** Whether a row is in the scope (which processes the View menu shows), apart from any search. */
const inScope = (row: ProcessRow, scope: Scope): boolean => (scope.kernel || !row.kernel) && (!scope.mine || row.own);

/**
 * Rows a search keeps: the name contains it (any case), or it is the pid.
 * Kernel threads only when asked for; only one's own processes when `mine`.
 */
export function filterRows(rows: readonly ProcessRow[], query: string, scope: Scope): ProcessRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => inScope(row, scope) && (q === "" || row.name.toLowerCase().includes(q) || String(row.pid) === q || row.user.toLowerCase() === q));
}

/** The summary's counts for what the View menu shows: hidden kernel threads count neither as processes nor as threads. */
export function scopeTotals(rows: readonly ProcessRow[], scope: Scope): { processes: number; threads: number } {
  let processes = 0;
  let threads = 0;
  for (const row of rows) {
    if (!inScope(row, scope)) continue;
    processes++;
    threads += row.threads;
  }
  return { processes, threads };
}

/**
 * The row Return in the search field picks: the selection while the search
 * still shows it, else the first match. Return only selects; quitting is
 * always the Quit… button or ❖K, then the sheet.
 */
export function submitSelection(shown: readonly number[], selected: number | null): number | null {
  return selected !== null && shown.includes(selected) ? selected : (shown[0] ?? null);
}
