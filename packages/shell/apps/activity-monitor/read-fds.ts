/**
 * The costlier reads, done only for the tab that shows them and only for the
 * person's own processes: a process's open sockets (the Network tab), its
 * threads' wakeups and its GPU use (the Energy tab). Listing a process's file
 * descriptors means a readlink per descriptor, so what was found is kept and
 * looked for again only every few looks.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { type GpuCounters, parseDrmFdinfo, parseWakeups, sumGpu } from "./energy-proc.ts";

const PROC = "/proc";
/** Looks between two counts of a process's sockets. */
export const SOCKETS_EVERY = 3;
/** Looks between two searches of a process's descriptors for the GPU. */
export const GPU_FDS_EVERY = 5;

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function list(path: string): string[] | null {
  try {
    return readdirSync(path);
  } catch {
    return null;
  }
}

/** The descriptors of `pid` whose target passes `wanted`; null when they can't be listed. */
function descriptors(pid: number, wanted: (target: string) => boolean): number[] | null {
  const fds = list(`${PROC}/${pid}/fd`);
  if (!fds) return null;
  const found: number[] = [];
  for (const fd of fds) {
    try {
      if (wanted(readlinkSync(`${PROC}/${pid}/fd/${fd}`))) found.push(Number(fd));
    } catch {
      // Closed while looking.
    }
  }
  return found;
}

export function countSockets(pid: number): number | null {
  return descriptors(pid, (target) => target.startsWith("socket:"))?.length ?? null;
}

/** The descriptors that are a GPU (a DRM render or card node). */
export function gpuDescriptors(pid: number): number[] {
  return descriptors(pid, (target) => target.startsWith("/dev/dri/")) ?? [];
}

/** The GPU counters of these descriptors of `pid`; null when none says anything (a driver without them, a VM's virtual GPU). */
export function readGpu(pid: number, fds: readonly number[]): GpuCounters | null {
  const clients = fds.flatMap((fd) => {
    const parsed = parseDrmFdinfo(read(`${PROC}/${pid}/fdinfo/${fd}`) ?? "");
    return parsed ? [parsed] : [];
  });
  return sumGpu(clients);
}

/** Voluntary context switches over all of `pid`'s threads; null when they can't be read. */
export function readWakeups(pid: number): number | null {
  const threads = list(`${PROC}/${pid}/task`);
  if (!threads) return null;
  let sum = 0;
  let any = false;
  for (const tid of threads) {
    const wakeups = parseWakeups(read(`${PROC}/${pid}/task/${tid}/status`) ?? "");
    if (wakeups === null) continue;
    sum += wakeups;
    any = true;
  }
  return any ? sum : null;
}
