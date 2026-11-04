/**
 * Reading what `flatpak` prints. Tables are tab-separated columns (the
 * columns Software asks for, flatpak-cmd.ts); progress comes from the
 * progress bar flatpak draws on a terminal, whose text has escape sequences
 * and carriage returns to peel off first.
 */

import { type Installation, isAppId } from "./ids.ts";
import { tidy } from "./text.ts";

export interface InstalledApp {
  id: string;
  name: string;
  version: string | null;
  branch: string;
  arch: string;
  origin: string;
  installation: Installation;
  /** Installed size in bytes, when flatpak says. */
  size: number | null;
  summary: string;
}

export interface FlatpakUpdate {
  id: string;
  name: string;
  version: string | null;
  branch: string;
  arch: string;
  origin: string;
  installation: Installation;
  downloadSize: number | null;
}

const UNITS: Readonly<Record<string, number>> = {
  bytes: 1,
  byte: 1,
  B: 1,
  kB: 1e3,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
};

/** "5.1 MB" (flatpak puts a no-break space in), "< 1.7 MB", "340 bytes" as bytes; null for anything else. */
export function parseSize(text: string): number | null {
  const match = text
    .replace(/[\u00a0\u202f]/g, " ")
    .trim()
    .match(/^[<~]?\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)$/);
  const unit = match?.[2] ? UNITS[match[2]] : undefined;
  if (!match?.[1] || unit === undefined) return null;
  const bytes = Number(match[1].replace(",", ".")) * unit;
  return Number.isFinite(bytes) ? Math.round(bytes) : null;
}

const dash = (value: string | undefined): string | null => {
  const text = tidy(value ?? "", 120);
  return text === "" || text === "-" ? null : text;
};

/** `flatpak list --app` rows; rows that don't have a valid id are skipped. */
export function parseList(output: string): InstalledApp[] {
  const apps: InstalledApp[] = [];
  for (const line of output.split("\n")) {
    const [id, name, version, branch, arch, origin, installation, size, ...summary] = line.replace(/\r$/, "").split("\t");
    if (!isAppId(id) || (installation !== "user" && installation !== "system")) continue;
    apps.push({
      id,
      name: dash(name) ?? id,
      version: dash(version),
      branch: dash(branch) ?? "stable",
      arch: dash(arch) ?? "",
      origin: dash(origin) ?? "",
      installation,
      size: parseSize(size ?? ""),
      summary: tidy(summary.join(" "), 200),
    });
  }
  return apps;
}

/** `flatpak remote-ls --updates --app` rows for one installation. */
export function parseUpdates(output: string, installation: Installation): FlatpakUpdate[] {
  const updates: FlatpakUpdate[] = [];
  for (const line of output.split("\n")) {
    const [id, name, version, branch, arch, origin, size] = line.replace(/\r$/, "").split("\t");
    if (!isAppId(id)) continue;
    updates.push({
      id,
      name: dash(name) ?? id,
      version: dash(version),
      branch: dash(branch) ?? "stable",
      arch: dash(arch) ?? "",
      origin: dash(origin) ?? "",
      installation,
      downloadSize: parseSize(size ?? ""),
    });
  }
  return updates;
}

/** `text` without terminal escapes (colors, cursor moves, OSC titles and progress) and with each carriage-returned line reduced to its last version. */
export function stripTerminal(text: string): string {
  const plain = text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][0-9A-Za-z]/g, "")
    .replace(/\u001b/g, "");
  return plain
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      return (parts.filter((part) => part.trim() !== "").pop() ?? "").trimEnd();
    })
    .join("\n");
}

export interface Progress {
  /** 0 to 1 over the whole operation, or null when flatpak hasn't said. */
  fraction: number | null;
  /** "Installing 2 of 3", or what it is doing. */
  label: string;
}

/**
 * Where an operation is, from everything flatpak has printed so far. The bar
 * reads `Installing 2/3… ████ 45%` (`Updating`, `Uninstalling` alike); the
 * overall fraction counts the finished steps and the part of the current one.
 */
export function parseProgress(output: string): Progress | null {
  const lines = stripTerminal(output).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    const bar = line.match(/(Installing|Updating|Uninstalling)(?:\s+(\d+)\/(\d+))?…?[^\d\n]*?(\d{1,3})%/);
    if (bar?.[1] && bar[4] !== undefined) {
      const step = bar[2] ? Number(bar[2]) : 1;
      const steps = bar[3] ? Math.max(Number(bar[3]), 1) : 1;
      const percent = Math.min(Number(bar[4]), 100);
      const fraction = Math.min((Math.max(step - 1, 0) + percent / 100) / steps, 1);
      return { fraction, label: steps > 1 ? `${bar[1]} ${step} of ${steps}` : bar[1] };
    }
    const phase = line.match(/^(Installing|Updating|Uninstalling)\s+(\S+)/);
    if (phase?.[1]) return { fraction: null, label: phase[1] };
  }
  return null;
}

/**
 * Why a flatpak command failed, in a sentence or two: its `error:` lines,
 * else the last lines of output.
 */
export function failureMessage(output: string): string {
  const lines = stripTerminal(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const errors = lines.filter((line) => /^(?:flatpak: )?error:/i.test(line)).map((line) => line.replace(/^(?:flatpak: )?error:\s*/i, ""));
  const picked = errors.length > 0 ? errors.slice(-3) : lines.slice(-3);
  return tidy(picked.join(" "), 400) || "The command failed without saying why.";
}
