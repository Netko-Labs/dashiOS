/**
 * One look at the system: every process and the machine's counters, read
 * from /proc with proc.ts's parsers. A process can end between listing and
 * reading; it is then simply not in this look. Only /proc is read, and
 * nothing is ever written.
 *
 * What doesn't change while a process runs one program (its name, command
 * line, and app) is read once and kept in the reader's `memory`, by pid,
 * start time, and the kernel's name for it (pids are reused, and a program
 * that execs another or renames itself is looked at again).
 */

import { readdirSync, readFileSync } from "node:fs";
import { FIRST_PARTY } from "../apps/index.ts";
import type { GpuCounters } from "./energy-proc.ts";
import { type AppCatalog, type AppIdentity, identify, parseCmdline } from "./index.ts";
import {
  type Counters,
  isKernelThread,
  type MemInfo,
  type NetCounters,
  type ProcIo,
  type ProcStat,
  parseDiskStats,
  parseIo,
  parseMemInfo,
  parseNetDev,
  parsePasswd,
  parseStat,
  parseStatus,
  parseSystemStat,
  processName,
  type SystemStat,
} from "./proc.ts";
import { countSockets, GPU_FDS_EVERY, gpuDescriptors, readGpu, readWakeups, SOCKETS_EVERY } from "./read-fds.ts";

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
  /** The memory that is its own, in bytes (RssAnon + RssShmem; proc.ts). */
  memory: number;
  kernel: boolean;
  /** Only for the user's own processes (others' io is not readable), and only when asked. */
  io: ProcIo | null;
  /** Open sockets; own processes only, and only when asked. */
  sockets: number | null;
  /** Its command line, the arguments joined by spaces ("" for a kernel thread). */
  command: string;
  /** The app it is by itself (identity.ts); null for a helper, or when the reader has no catalog. */
  app: AppIdentity | null;
  /** Voluntary context switches over all its threads; own processes, and only when asked (the Energy tab). */
  wakeups: number | null;
  /** Its GPU counters; own processes with a GPU open whose driver counts, and only when asked. */
  gpu: GpuCounters | null;
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

/** What a reader keeps between looks. */
export interface ReaderMemory {
  /** By `pid:starttime:comm`. */
  known: Map<string, Known>;
  /** Looks taken so far. */
  looks: number;
}

interface Known {
  name: string;
  command: string;
  app: AppIdentity | null;
  sockets?: { count: number | null; look: number };
  gpuFds?: { fds: number[]; look: number };
}

export function readerMemory(): ReaderMemory {
  return { known: new Map(), looks: 0 };
}

export interface ReadOptions {
  /** Read each own process's io (the Disk tab). */
  io: boolean;
  /** Count each own process's sockets (the Network tab). */
  sockets: boolean;
  /** Read kernel threads too (true when absent); without them a look skips their status files. */
  kernel?: boolean;
  /** Read each own process's wakeups and GPU use (the Energy tab). */
  energy?: boolean;
  ownUid: number;
  pageSize: number;
  memory: ReaderMemory;
  /** The installed apps, to tell which app each process is; without it no process has one. */
  apps?: AppCatalog;
}

const PROC = "/proc";
const COMMAND_LIMIT = 1024;

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

/** What is read once per program: the name (the kernel's, or completed from the command line), the command line, the app. */
function knownFor(pid: number, stat: ProcStat, options: ReadOptions): Known {
  const key = `${pid}:${stat.starttime}:${stat.comm}`;
  const kept = options.memory.known.get(key);
  if (kept) return kept;
  const argv = isKernelThread(stat) ? [] : parseCmdline(read(`${PROC}/${pid}/cmdline`));
  const cmdline = argv.join("\0");
  const name = stat.comm.length >= 15 ? (firstPartyName(stat.comm) ?? processName(stat.comm, cmdline)) : stat.comm;
  const app = options.apps && argv.length > 0 ? identify({ comm: stat.comm, argv, cgroup: read(`${PROC}/${pid}/cgroup`) ?? "" }, options.apps) : null;
  const known: Known = { name, command: argv.join(" ").slice(0, COMMAND_LIMIT), app };
  options.memory.known.set(key, known);
  return known;
}

function socketsOf(pid: number, known: Known, look: number): number | null {
  if (!known.sockets || look - known.sockets.look >= SOCKETS_EVERY) known.sockets = { count: countSockets(pid), look };
  return known.sockets.count;
}

function gpuOf(pid: number, known: Known, look: number): GpuCounters | null {
  if (!known.gpuFds || look - known.gpuFds.look >= GPU_FDS_EVERY) known.gpuFds = { fds: gpuDescriptors(pid), look };
  return known.gpuFds.fds.length > 0 ? readGpu(pid, known.gpuFds.fds) : null;
}

function readProcess(pid: number, options: ReadOptions): ProcessSample | null {
  const stat = parseStat(read(`${PROC}/${pid}/stat`) ?? "");
  if (!stat || (options.kernel === false && isKernelThread(stat))) return null;
  const status = parseStatus(read(`${PROC}/${pid}/status`) ?? "");
  if (!status) return null;
  const known = knownFor(pid, stat, options);
  const own = status.uid === options.ownUid && !isKernelThread(stat);
  const look = options.memory.looks;
  return {
    pid,
    ppid: stat.ppid,
    name: known.name,
    uid: status.uid,
    state: stat.state,
    cpuTicks: stat.utime + stat.stime,
    threads: stat.threads,
    starttime: stat.starttime,
    memory: status.rss ?? stat.rssPages * options.pageSize,
    kernel: isKernelThread(stat),
    io: own && options.io ? parseIo(read(`${PROC}/${pid}/io`) ?? "") : null,
    sockets: own && options.sockets ? socketsOf(pid, known, look) : null,
    command: known.command,
    app: known.app,
    wakeups: own && options.energy ? readWakeups(pid) : null,
    gpu: own && options.energy ? gpuOf(pid, known, look) : null,
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
  options.memory.looks++;
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const sample = readProcess(Number(entry), options);
    if (sample) processes.set(sample.pid, sample);
  }
  // What was known about processes that are gone is forgotten.
  const live = new Set([...processes.values()].map((p) => `${p.pid}:${p.starttime}`));
  for (const key of options.memory.known.keys()) if (!live.has(key.split(":", 2).join(":"))) options.memory.known.delete(key);
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
