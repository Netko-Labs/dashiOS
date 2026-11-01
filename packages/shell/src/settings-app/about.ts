/**
 * What About shows: the version, the machine, and how full the disk is. The
 * parsers are pure; `readAbout` gathers the pieces from /proc, /sys, and the
 * PCI id list, each of which may be missing (a VM, a container) without
 * costing the rest.
 */

import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { hostname, release, totalmem } from "node:os";
import pkg from "../../package.json" with { type: "json" };

export interface Processor {
  model: string;
  /** Logical processors. */
  threads: number;
}

/** The CPU's marketing name and thread count from /proc/cpuinfo; null when it names none. */
export function parseCpuinfo(text: string): Processor | null {
  let model: string | null = null;
  let threads = 0;
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "processor" && /^\d+$/.test(value)) threads++;
    // x86 says "model name"; some ARM kernels say "Model" or "Hardware".
    else if (model === null && value && (key === "model name" || key === "hardware")) model = tidyCpuName(value);
  }
  return model ? { model, threads } : null;
}

/** "Intel(R) Core(TM) i7-1165G7 @ 2.80GHz" → "Intel Core i7-1165G7 @ 2.80GHz": no trademark marks, single spaces. */
export function tidyCpuName(name: string): string {
  return name.replace(/\((?:R|TM)\)/gi, "").replace(/\s+/g, " ").trim();
}

/** Disk space for `df`-style numbers: total and free, in bytes. */
export interface DiskSpace {
  total: number;
  free: number;
}

/** What `statfs` says, as bytes (free is what an ordinary user can use). */
export function diskSpace(stats: { bsize: number; blocks: number; bavail: number }): DiskSpace | null {
  const total = stats.bsize * stats.blocks;
  const free = stats.bsize * stats.bavail;
  return Number.isFinite(total) && Number.isFinite(free) && total > 0 && free >= 0 ? { total, free: Math.min(free, total) } : null;
}

/** Decimal gigabytes or terabytes, as a drive is sold and as the Mac shows it: "843 GB", "1.2 TB". */
export function formatStorage(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${trim(gb / 1000)} TB`;
  return `${gb >= 100 ? Math.round(gb) : trim(gb)} GB`;
}

/** Memory in binary gigabytes, as the Mac shows it: "32 GB", "7.6 GB". */
export function formatMemory(bytes: number): string {
  const gib = bytes / 2 ** 30;
  // A "32 GB" machine reports a little under 32 GiB; round to the size it was sold as.
  const whole = Math.round(gib);
  return Math.abs(gib - whole) / Math.max(whole, 1) < 0.06 && whole >= 1 ? `${whole} GB` : `${trim(gib)} GB`;
}

const trim = (value: number): string => String(Math.round(value * 10) / 10);

/** Vendor and device ids as `/sys/class/drm/cardN/device/{vendor,device}` hold them: `0x1002`. */
export function parseHexId(text: string): string | null {
  const match = /^0x([0-9a-fA-F]{4})\s*$/.exec(text);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** The names `pci.ids` gives a vendor and device; null for ids it does not list. */
export function lookupPci(pciIds: string, vendor: string, device: string): { vendor: string; device: string | null } | null {
  if (!/^[0-9a-f]{4}$/.test(vendor) || !/^[0-9a-f]{4}$/.test(device)) return null;
  const start = pciIds.search(new RegExp(`^${vendor}  `, "m"));
  if (start < 0) return null;
  const rest = pciIds.slice(start);
  const lineEnd = rest.indexOf("\n");
  const vendorName = rest.slice(vendor.length + 2, lineEnd < 0 ? undefined : lineEnd).trim();
  // The vendor's devices are the tab-indented lines up to the next vendor.
  const next = rest.slice(lineEnd + 1).search(/^[0-9a-f]{4}  /m);
  const block = lineEnd < 0 ? "" : next < 0 ? rest.slice(lineEnd + 1) : rest.slice(lineEnd + 1, lineEnd + 1 + next);
  const found = new RegExp(`^\\t${device}  (.+)$`, "m").exec(block);
  return vendorName ? { vendor: vendorName, device: found?.[1]?.trim() ?? null } : null;
}

const VENDOR_SHORT: Record<string, string> = { "1002": "AMD", "10de": "NVIDIA", "8086": "Intel", "1af4": "Virtio", "15ad": "VMware", "1234": "QEMU" };

/**
 * A short GPU name: the device's bracketed marketing name with the vendor in
 * front ("AMD Radeon 890M Graphics"), else the full device name, else the ids.
 */
export function gpuName(vendor: string, device: string, pciIds: string | null): string {
  const names = pciIds ? lookupPci(pciIds, vendor, device) : null;
  const maker = VENDOR_SHORT[vendor] ?? names?.vendor ?? vendor;
  if (!names?.device) return `${maker} (${vendor}:${device})`;
  const bracketed = /\[([^\]]+)\]\s*$/.exec(names.device)?.[1];
  const model = bracketed ?? names.device;
  // "Navi 31 [Radeon RX 7900 XT]" already says Radeon; do not repeat a vendor the model starts with.
  return model.toLowerCase().startsWith(maker.toLowerCase()) ? model : `${maker} ${model}`;
}

/**
 * An os-release file's fields (os-release(5)): `KEY=value` lines, values
 * optionally in double or single quotes, with `\\`, `\"`, `\$`, and `` \` ``
 * escaped inside double quotes. Comments, blank lines, and lines that are
 * not assignments are skipped.
 */
export function parseOsReleaseFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = (match[2] as string).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\([\\"$`])/g, "$1");
    else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    fields[match[1] as string] = value;
  }
  return fields;
}

/** The `PRETTY_NAME` of an os-release file ("Fedora Linux 44"), if it has one. */
export function parseOsRelease(text: string): string | null {
  return parseOsReleaseFields(text).PRETTY_NAME || null;
}

/** What About heads the page with: Dashi's own release (dashi-release) when os-release is Dashi's. */
export interface OsIdentity {
  /** "Dashi" */
  name: string;
  /** "0.1 beta", and the build it is ("0.1.0~beta.20261030.abc1234"). */
  version: string | null;
  build: string | null;
}

/**
 * Dashi's identity and what it runs on, from os-release. A system that says
 * it is Dashi (ID=dashi) names itself and its base (`DASHI_BASED_ON`); on any
 * other distribution Dashi is a desktop on top of it, and its PRETTY_NAME is
 * the base.
 */
export function osIdentity(text: string): { os: OsIdentity | null; base: string | null } {
  const fields = parseOsReleaseFields(text);
  if (fields.ID === "dashi") {
    return {
      os: { name: fields.NAME || "Dashi", version: fields.VERSION || null, build: fields.DASHI_BUILD || null },
      base: fields.DASHI_BASED_ON || null,
    };
  }
  return { os: null, base: fields.PRETTY_NAME || null };
}

export interface AboutInfo {
  /** The shell's own version (package.json). */
  version: string;
  /** The installed system's name and release, when it is Dashi (os-release ID=dashi). */
  os: OsIdentity | null;
  hostname: string;
  /** The distribution Dashi runs on, when it says. */
  base: string | null;
  kernel: string;
  processor: Processor | null;
  memory: number;
  gpus: string[];
  disk: DiskSpace | null;
}

/** "Version 0.1 beta (0.1.0~beta.20261030.abc1234)" on Dashi's own release; the shell's version elsewhere. */
export function versionLine(info: Pick<AboutInfo, "version" | "os">): string {
  if (!info.os?.version) return `Version ${info.version}`;
  return info.os.build ? `Version ${info.os.version} (${info.os.build})` : `Version ${info.os.version}`;
}

/** Where the pieces come from; tests hand in their own. */
export interface AboutSources {
  readText(path: string): string | null;
  listDir(path: string): string[];
  statfs(path: string): { bsize: number; blocks: number; bavail: number } | null;
  hostname(): string;
  release(): string;
  totalmem(): number;
}

export const systemSources: AboutSources = {
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  listDir(path) {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  statfs(path) {
    try {
      return statfsSync(path);
    } catch {
      return null;
    }
  },
  hostname,
  release,
  totalmem,
};

export const PCI_IDS = "/usr/share/hwdata/pci.ids";

/** The graphics adapters under /sys/class/drm (cardN, not its connectors), each once. */
export function readGpus(sources: AboutSources, pciIds: string | null): string[] {
  const names = sources
    .listDir("/sys/class/drm")
    .filter((entry) => /^card\d+$/.test(entry))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .flatMap((card) => {
      const vendor = parseHexId(sources.readText(`/sys/class/drm/${card}/device/vendor`) ?? "");
      const device = parseHexId(sources.readText(`/sys/class/drm/${card}/device/device`) ?? "");
      return vendor && device ? [gpuName(vendor, device, pciIds)] : [];
    });
  return [...new Set(names)];
}

export function readAbout(sources: AboutSources = systemSources): AboutInfo {
  const cpuinfo = sources.readText("/proc/cpuinfo");
  const osRelease = sources.readText("/etc/os-release");
  const stats = sources.statfs("/");
  const identity = osRelease ? osIdentity(osRelease) : { os: null, base: null };
  return {
    version: pkg.version,
    os: identity.os,
    hostname: sources.hostname(),
    base: identity.base,
    kernel: sources.release(),
    processor: cpuinfo ? parseCpuinfo(cpuinfo) : null,
    memory: sources.totalmem(),
    gpus: readGpus(sources, sources.readText(PCI_IDS)),
    disk: stats ? diskSpace(stats) : null,
  };
}
