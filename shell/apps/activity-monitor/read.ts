/**
 * One look at the system: every process and the machine's counters, read
 * from /proc with proc.ts's parsers. A process can end between listing and
 * reading; it is then simply not in this look.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { FIRST_PARTY } from "../../src/first-party.ts";
import {
  type Counters,
  isKernelThread,
  type MemInfo,
  type NetCounters,
  parseDiskStats,
  parseIo,
  parseMemInfo,
  parseNetDev,
  parsePasswd,
  parseStat,
  parseStatus,
  parseSystemStat,
  processName,
  type ProcIo,
  type SystemStat,
} from "./proc.ts";

export interface ProcessSample {
  pid: number;
  ppid: number;
  name: string;
  uid: number;
  state: string;
  /** User and system time together, in clock ticks. */
  cpuTicks: number;
  threads: number;
  starttime: number;
  /** Resident memory in bytes. */
  memory: number;
  kernel: boolean;
  /** Only for the user's own processes (others' io is not readable), and only when asked. */
  io: ProcIo | null;
  /** Open sockets; own processes only, and only when asked. */
  sockets: number | null;
}

export interface Snapshot {
  /** Milliseconds, monotonic. */
  at: number;
  processes: Map<number, ProcessSample>;
  cpu: SystemStat | null;
  memory: MemInfo | null;
  disk: Counters;
  net: NetCounters;
}

export interface ReadOptions {
  /** Read each own process's io (the Disk tab). */
  io: boolean;
  /** Count each own process's sockets (the Network tab). */
  sockets: boolean;
  ownUid: number;
  pageSize: number;
  /** Names worked out from command lines, by pid and start time (pids are reused). */
  names: Map<string, string>;
}

const PROC = "/proc";

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** A first-party app names its process after itself (kit/name.ts); the kernel kept 15 bytes of it. */
export function firstPartyName(comm: string, names: readonly string[] = FIRST_PARTY.map((spec) => spec.name)): string | null {
  if (comm.length < 15) return null;
  return names.find((name) => name.startsWith(comm)) ?? null;
}

function countSockets(pid: number): number | null {
  let fds: string[];
  try {
    fds = readdirSync(`${PROC}/${pid}/fd`);
  } catch {
    return null;
  }
  let sockets = 0;
  for (const fd of fds) {
    try {
      if (readlinkSync(`${PROC}/${pid}/fd/${fd}`).startsWith("socket:")) sockets++;
    } catch {
      // Closed while counting.
    }
  }
  return sockets;
}

function readProcess(pid: number, options: ReadOptions): ProcessSample | null {
  const stat = parseStat(read(`${PROC}/${pid}/stat`) ?? "");
  const status = parseStatus(read(`${PROC}/${pid}/status`) ?? "");
  if (!stat || !status) return null;
  // Short names are the kernel's own and can change (an app renames itself once it starts);
  // only names worked out from a cut-short one and the command line are kept.
  let name = stat.comm;
  if (stat.comm.length >= 15) {
    const key = `${pid}:${stat.starttime}:${stat.comm}`;
    name = options.names.get(key) ?? firstPartyName(stat.comm) ?? processName(stat.comm, read(`${PROC}/${pid}/cmdline`));
    options.names.set(key, name);
  }
  const own = status.uid === options.ownUid;
  return {
    pid,
    ppid: stat.ppid,
    name,
    uid: status.uid,
    state: stat.state,
    cpuTicks: stat.utime + stat.stime,
    threads: stat.threads,
    starttime: stat.starttime,
    memory: status.rss ?? stat.rssPages * options.pageSize,
    kernel: isKernelThread(stat),
    io: own && options.io ? parseIo(read(`${PROC}/${pid}/io`) ?? "") : null,
    sockets: own && options.sockets ? countSockets(pid) : null,
  };
}

export function readSnapshot(options: ReadOptions): Snapshot {
  const processes = new Map<number, ProcessSample>();
  let entries: string[] = [];
  try {
    entries = readdirSync(PROC);
  } catch {
    // No /proc: an empty look.
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const sample = readProcess(Number(entry), options);
    if (sample) processes.set(sample.pid, sample);
  }
  // Names of processes that are gone are forgotten.
  const live = new Set([...processes.values()].map((p) => `${p.pid}:${p.starttime}:`));
  for (const key of options.names.keys()) if (!live.has(`${key.split(":", 2).join(":")}:`)) options.names.delete(key);
  return {
    at: performance.now(),
    processes,
    cpu: parseSystemStat(read(`${PROC}/stat`) ?? ""),
    memory: parseMemInfo(read(`${PROC}/meminfo`) ?? ""),
    disk: parseDiskStats(read(`${PROC}/diskstats`) ?? ""),
    net: parseNetDev(read(`${PROC}/net/dev`) ?? ""),
  };
}

/** uid → user name, from /etc/passwd (users from a directory service show as their uid). */
export function readUsers(): Map<number, string> {
  return parsePasswd(read("/etc/passwd") ?? "");
}

/** `getconf` for a number, or the fallback. */
export function sysconf(name: "CLK_TCK" | "PAGESIZE", fallback: number): number {
  try {
    const result = Bun.spawnSync(["getconf", name], { stdout: "pipe", stderr: "ignore" });
    const value = Number(result.stdout.toString().trim());
    return result.exitCode === 0 && Number.isInteger(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}
