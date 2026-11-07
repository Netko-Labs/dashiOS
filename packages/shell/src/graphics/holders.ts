/**
 * "Using the graphics card": the processes holding the card's device nodes
 * open (its /dev/dri card and render nodes, /dev/nvidiaN), which keep it
 * awake. Found the way cardwire's --lsof does, from /proc/<pid>/fd; the
 * shell sees the person's own processes, the ones it can quit. Names the
 * shell can't see (another user's, a system service's) come from cardwire's
 * `Lsof()` when it runs, listed without Quit.
 *
 * Each holder's draw is an estimate: the card's own draw when the kernel
 * reports it (hwmon on the card), shared among the holders, else the
 * typical cost of keeping a laptop graphics card awake.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

/** What an awake, lightly used laptop graphics card draws, when nothing better is known. */
export const AWAKE_WATTS = 8;

export interface ProcessFds {
  pid: number;
  /** /proc/<pid>/comm. */
  comm: string;
  /** Where each of its fds points. */
  links: readonly string[];
}

export interface Holder {
  /** Empty when only cardwire named it: the shell can't see it, so it isn't ours to quit. */
  pids: number[];
  name: string;
  /** Watts, estimated. */
  watts: number | null;
}

/**
 * The compositor is never a holder: it opens the card only while a screen is
 * connected to it, a client's buffer only the card reads is on screen, or the
 * shell keeps it (IPC `gpus`), each the reason in its own right; and quitting
 * it would end the session.
 */
const COMPOSITOR = "dashi-comp";

/** The processes among `processes` holding any of `nodes`, never the shell itself or the compositor. */
export function holdingProcesses(processes: readonly ProcessFds[], nodes: readonly string[], self: number = process.pid): ProcessFds[] {
  const wanted = new Set(nodes);
  return processes.filter((proc) => proc.pid !== self && proc.comm !== COMPOSITOR && proc.links.some((link) => wanted.has(link)));
}

/**
 * Holders by app: the processes grouped under the name `nameOf` gives each
 * pid (the app's, from its windows; else the process name), then the names
 * only cardwire saw. The draw is shared out evenly.
 */
export function groupHolders(
  processes: readonly ProcessFds[],
  nameOf: (pid: number, comm: string) => string,
  unseen: readonly string[],
  cardWatts: number | null,
): Holder[] {
  const groups = new Map<string, number[]>();
  const comms = new Set<string>();
  for (const proc of processes) {
    const name = nameOf(proc.pid, proc.comm);
    comms.add(proc.comm);
    groups.set(name, [...(groups.get(name) ?? []), proc.pid]);
  }
  const holders: Holder[] = [...groups].map(([name, pids]) => ({ name, pids, watts: null }));
  for (const name of unseen) if (name !== COMPOSITOR && !comms.has(name) && !groups.has(name)) holders.push({ name, pids: [], watts: null });
  const total = cardWatts ?? (holders.length > 0 ? AWAKE_WATTS : null);
  return holders.map((holder) => ({ ...holder, watts: total === null ? null : Math.round((total / holders.length) * 10) / 10 }));
}

/** Every process's fds that this user can read, from /proc. */
export function readProcessFds(root = "/proc"): ProcessFds[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: ProcessFds[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[];
    try {
      fds = readdirSync(join(root, entry, "fd"));
    } catch {
      continue;
    }
    const links: string[] = [];
    for (const fd of fds) {
      try {
        const target = readlinkSync(join(root, entry, "fd", fd));
        if (target.startsWith("/dev/")) links.push(target);
      } catch {
        // Closed while reading.
      }
    }
    if (links.length === 0) continue;
    let comm = entry;
    try {
      comm = readFileSync(join(root, entry, "comm"), "utf8").trim();
    } catch {
      // Gone; keep the pid as its name.
    }
    out.push({ pid: Number(entry), comm, links });
  }
  return out;
}

/** The card's own draw in watts, when its driver reports it in hwmon (amdgpu does; NVIDIA's doesn't, and asking nvidia-smi would wake it). */
export function readCardWatts(pci: string, root = "/sys/bus/pci/devices"): number | null {
  const hwmon = join(root, pci, "hwmon");
  let entries: string[];
  try {
    entries = readdirSync(hwmon);
  } catch {
    return null;
  }
  for (const entry of entries) {
    for (const file of ["power1_average", "power1_input"]) {
      try {
        const microwatts = Number(readFileSync(join(hwmon, entry, file), "utf8").trim());
        if (Number.isFinite(microwatts) && microwatts >= 0) return Math.round(microwatts / 100_000) / 10;
      } catch {
        // Not this file.
      }
    }
  }
  return null;
}
