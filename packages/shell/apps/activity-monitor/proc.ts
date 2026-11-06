/**
 * Reading Linux's /proc as data: pure parsers from a file's text to what
 * Activity Monitor shows. Nothing here touches the filesystem (read.ts does),
 * so every parser is tested against fixtures. Anything unreadable or
 * malformed is null, never a guess.
 */

/** /proc/<pid>/stat, the fields used. Times are in clock ticks. */
export interface ProcStat {
  pid: number;
  /** The kernel's name for it (15 characters at most). */
  comm: string;
  state: string;
  ppid: number;
  utime: number;
  stime: number;
  threads: number;
  /** Clock ticks after boot when it started: with the pid, who it is (pids are reused). */
  starttime: number;
  /** Resident set, in pages. */
  rssPages: number;
}

/**
 * The name sits in parentheses and may hold spaces and parentheses itself,
 * so it runs to the last ")" on the line.
 */
export function parseStat(text: string): ProcStat | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(text.slice(0, open).trim());
  const rest = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // rest[0] is field 3 (state); field n is rest[n - 3].
  const field = (n: number): number => Number(rest[n - 3]);
  const stat: ProcStat = {
    pid,
    comm: text.slice(open + 1, close),
    state: rest[0] ?? "?",
    ppid: field(4),
    utime: field(14),
    stime: field(15),
    threads: field(20),
    starttime: field(22),
    rssPages: field(24),
  };
  const numbers = [stat.pid, stat.ppid, stat.utime, stat.stime, stat.threads, stat.starttime, stat.rssPages];
  return Number.isInteger(pid) && pid > 0 && numbers.every(Number.isFinite) ? stat : null;
}

/** /proc/<pid>/status, the fields used. */
export interface ProcStatus {
  /** The real user id. */
  uid: number;
  /**
   * The memory that is the process's own, in bytes: its anonymous pages and
   * the shared memory it holds (RssAnon + RssShmem), not the libraries and
   * files it maps, which every process mapping them would count again (VmRSS
   * does). VmRSS on a kernel that doesn't split it; null for kernel threads.
   */
  rss: number | null;
}

/** `Key:\tvalue` lines into a map. */
function keyed(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 1).trim());
  }
  return fields;
}

/** "123 kB" → bytes. */
function kilobytes(value: string | undefined): number | null {
  const match = value?.match(/^(\d+)\s*kB$/);
  return match ? Number(match[1]) * 1024 : null;
}

export function parseStatus(text: string): ProcStatus | null {
  const fields = keyed(text);
  const uid = Number(fields.get("Uid")?.split(/\s+/)[0]);
  if (!Number.isInteger(uid) || uid < 0) return null;
  const anon = kilobytes(fields.get("RssAnon"));
  const shmem = kilobytes(fields.get("RssShmem"));
  return { uid, rss: anon !== null && shmem !== null ? anon + shmem : kilobytes(fields.get("VmRSS")) };
}

/** /proc/<pid>/io: bytes the process made the storage layer read and write. */
export interface ProcIo {
  read: number;
  /** Written, less what it truncated away before it reached the disk (`cancelled_write_bytes`). */
  written: number;
}

export function parseIo(text: string): ProcIo | null {
  const fields = keyed(text);
  const read = Number(fields.get("read_bytes"));
  const written = Number(fields.get("write_bytes"));
  const cancelled = Number(fields.get("cancelled_write_bytes") ?? 0);
  if (!fields.has("read_bytes") || !Number.isFinite(read) || !Number.isFinite(written)) return null;
  return { read, written: Math.max(0, written - (Number.isFinite(cancelled) ? cancelled : 0)) };
}

/**
 * A better name than the kernel's when it cut it short: comm holds 15
 * characters, so "gnome-shell-cal" is completed from the command line's
 * program name when that starts the same way.
 */
export function processName(comm: string, cmdline: string | null): string {
  if (comm.length < 15 || !cmdline) return comm;
  const argv0 = cmdline.split("\0")[0] ?? "";
  const program = argv0.split("/").at(-1) ?? "";
  return program.startsWith(comm) ? program : comm;
}

/** The "cpu" lines of /proc/stat, in clock ticks. */
export interface CpuTimes {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

export function parseCpuLine(line: string): CpuTimes | null {
  const [label, ...values] = line.trim().split(/\s+/);
  if (!label?.startsWith("cpu")) return null;
  const n = values.map(Number);
  if (n.length < 4 || n.slice(0, 8).some((value) => !Number.isFinite(value))) return null;
  const at = (i: number): number => n[i] ?? 0;
  return { user: at(0), nice: at(1), system: at(2), idle: at(3), iowait: at(4), irq: at(5), softirq: at(6), steal: at(7) };
}

export interface SystemStat {
  /** All CPUs together. */
  total: CpuTimes;
  cpus: number;
}

export function parseSystemStat(text: string): SystemStat | null {
  const lines = text.split("\n");
  const total = parseCpuLine(lines[0] ?? "");
  if (!total || !lines[0]?.startsWith("cpu ")) return null;
  const cpus = lines.filter((line) => /^cpu\d+\s/.test(line)).length;
  return { total, cpus: Math.max(cpus, 1) };
}

/** /proc/meminfo, in bytes. */
export interface MemInfo {
  total: number;
  available: number;
  /** Page cache and buffers: memory that holds files and gives way to apps. */
  cached: number;
  swapTotal: number;
  swapFree: number;
}

export function parseMemInfo(text: string): MemInfo | null {
  const fields = keyed(text);
  const get = (key: string): number | null => kilobytes(fields.get(key));
  const total = get("MemTotal");
  const available = get("MemAvailable");
  if (total === null || available === null) return null;
  return {
    total,
    available,
    cached: (get("Cached") ?? 0) + (get("Buffers") ?? 0),
    swapTotal: get("SwapTotal") ?? 0,
    swapFree: get("SwapFree") ?? 0,
  };
}

/** Totals since boot, summed over devices. */
export interface Counters {
  readOps: number;
  writeOps: number;
  readBytes: number;
  writeBytes: number;
}

/** Whole disks, not their partitions or loop, RAM, and device-mapper devices (their I/O is counted on the disk under them). */
export function isWholeDisk(name: string): boolean {
  return /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(name);
}

/** /proc/diskstats summed over whole disks; sectors are 512 bytes whatever the device's own. */
export function parseDiskStats(text: string): Counters {
  const sum: Counters = { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 };
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !isWholeDisk(f[2] ?? "")) continue;
    const n = (i: number): number => Number(f[i]) || 0;
    sum.readOps += n(3);
    sum.readBytes += n(5) * 512;
    sum.writeOps += n(7);
    sum.writeBytes += n(9) * 512;
  }
  return sum;
}

export interface NetCounters {
  packetsIn: number;
  packetsOut: number;
  bytesIn: number;
  bytesOut: number;
}

/**
 * Interfaces whose traffic is already counted on another one: loopback,
 * container and VM links and bridges (veth, docker, br-, virbr, vnet, tap),
 * and tunnels (tun, wg), whose packets also cross the real interface under them.
 */
export function isVirtualInterface(name: string): boolean {
  return name === "lo" || /^(veth|docker|br-|virbr|vnet|tap|tun|wg)/.test(name);
}

/** /proc/net/dev summed over the real interfaces (`isVirtualInterface` ones are left out). */
export function parseNetDev(text: string): NetCounters {
  const sum: NetCounters = { packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0 };
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (isVirtualInterface(name) || name.includes("|")) continue;
    const f = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (f.length < 16) continue;
    sum.bytesIn += f[0] || 0;
    sum.packetsIn += f[1] || 0;
    sum.bytesOut += f[8] || 0;
    sum.packetsOut += f[9] || 0;
  }
  return sum;
}

/** /etc/passwd as uid → name. */
export function parsePasswd(text: string): Map<number, string> {
  const users = new Map<number, string>();
  for (const line of text.split("\n")) {
    const [name, , uid] = line.split(":");
    const id = Number(uid);
    if (name && uid !== undefined && uid !== "" && Number.isInteger(id) && !users.has(id)) users.set(id, name);
  }
  return users;
}

/** Kernel threads have no memory of their own: kthreadd (pid 2) and its children. */
export function isKernelThread(stat: Pick<ProcStat, "pid" | "ppid">): boolean {
  return stat.pid === 2 || stat.ppid === 2;
}
