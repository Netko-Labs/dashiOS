/**
 * Which apps use the energy: each process's processor time between two looks
 * at /proc, credited to the app it or one of its ancestors is (the same
 * apps, by the same keys, as Activity Monitor's: shared/processes/) or whose
 * window it owns (a browser's helper processes count as the browser), else
 * to the process's own name. Processor time is what Linux tells per process, and on a laptop
 * it is most of what an app costs the battery: the "energy impact" here is
 * the share of one core it kept busy, averaged over the last minutes.
 *
 * The person's own processes only: the system's daemons are not an app they
 * could quit.
 */

import { type AppIdentity, ownerOf as ownerOfProcess } from "../../shared/processes/index.ts";
import type { ProcessSample } from "../../shared/processes/read.ts";

export interface AppUse {
  /** The app's id when a window owns it, else `process:<name>`. */
  key: string;
  name: string;
  /** Cores kept busy on average: 0.5 is half of one core. */
  cores: number;
}

/** A window's process and the app it belongs to. */
export interface WindowOwner {
  pid: number;
  key: string;
  name: string;
}

/** Above this share of a core over the window, an app is "using significant energy" (as a Mac lists them). */
export const SIGNIFICANT_CORES = 0.15;

/**
 * How the processes of one look belong to apps, as Activity Monitor groups
 * them (shared/processes/owners.ts): walking up from each to the first that is an
 * app by itself (the reader's `app`) or owns a window; else the process's own
 * name.
 */
export function ownerOf(processes: ReadonlyMap<number, ProcessSample>, windows: readonly WindowOwner[]): (pid: number) => { key: string; name: string } {
  const byPid = new Map(windows.map((window): [number, AppIdentity] => [window.pid, { key: window.key, name: window.name, icon: "" }]));
  const walk = ownerOfProcess(processes, (sample) => sample.app ?? byPid.get(sample.pid) ?? null);
  return (pid) => {
    const found = walk(pid);
    if (found) return { key: found.key, name: found.name };
    const name = processes.get(pid)?.name ?? String(pid);
    return { key: `process:${name}`, name };
  };
}

/**
 * The apps' processor use between two looks `seconds` apart: ticks are
 * counted only for a process present in both (same pid and start time, as
 * pids are reused), for the person's own (`uid`), in clock ticks of `hz`.
 */
export function usageBetween(
  before: ReadonlyMap<number, ProcessSample>,
  after: ReadonlyMap<number, ProcessSample>,
  seconds: number,
  options: { uid: number; hz: number; owner: (pid: number) => { key: string; name: string } },
): AppUse[] {
  if (seconds <= 0) return [];
  const totals = new Map<string, AppUse>();
  for (const process of after.values()) {
    if (process.uid !== options.uid || process.kernel) continue;
    const earlier = before.get(process.pid);
    if (!earlier || earlier.starttime !== process.starttime) continue;
    const ticks = Math.max(process.cpuTicks - earlier.cpuTicks, 0);
    if (ticks === 0) continue;
    const owner = options.owner(process.pid);
    const entry = totals.get(owner.key) ?? { ...owner, cores: 0 };
    entry.cores += ticks / options.hz / seconds;
    totals.set(owner.key, entry);
  }
  return [...totals.values()].map((use) => ({ ...use, cores: Math.round(use.cores * 1000) / 1000 }));
}

/** Several measurements averaged over the time they cover, heaviest first. */
export function averageUse(measurements: readonly (readonly AppUse[])[]): AppUse[] {
  if (measurements.length === 0) return [];
  const totals = new Map<string, AppUse>();
  for (const measurement of measurements) {
    for (const use of measurement) {
      const entry = totals.get(use.key) ?? { key: use.key, name: use.name, cores: 0 };
      entry.cores += use.cores / measurements.length;
      totals.set(use.key, entry);
    }
  }
  return [...totals.values()].map((use) => ({ ...use, cores: Math.round(use.cores * 1000) / 1000 })).sort((a, b) => b.cores - a.cores);
}

/** The apps using significant energy, heaviest first. */
export function significant(uses: readonly AppUse[]): AppUse[] {
  return uses.filter((use) => use.cores >= SIGNIFICANT_CORES);
}
