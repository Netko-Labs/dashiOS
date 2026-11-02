/**
 * Reading `pkcon` (PackageKit's console client) and `dnf needs-restarting`:
 * the list of pending updates, an update's progress, and which updates need
 * a restart to finish.
 */

import { tidy } from "./text.ts";

export interface SystemUpdate {
  /** The package name: `kernel-core`. */
  name: string;
  /** `6.12.4-200.fc41`: version and release. */
  version: string;
  arch: string;
  repo: string;
  /** PackageKit's word for it: "Security", "Bug fix", "Enhancement", "Normal", "Available". */
  kind: string;
}

/**
 * `Available    t3code-0.1.6^20261030-1.fc44.x86_64 (terra)` lines after
 * `Results:`. The package is `name-version-release.arch`; version and
 * release may contain `^` and `~`, names may contain dashes.
 */
export function parseUpdateList(output: string): SystemUpdate[] {
  const updates: SystemUpdate[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const match = line.replace(/\r$/, "").match(/^([A-Za-z][A-Za-z ]{1,24}?)\s{2,}(\S+) \(([^()]{1,80})\)\s*$/);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const parsed = splitPackage(match[2]);
    if (!parsed || seen.has(`${parsed.name}.${parsed.arch}`)) continue;
    seen.add(`${parsed.name}.${parsed.arch}`);
    updates.push({ ...parsed, repo: tidy(match[3], 60), kind: tidy(match[1], 24) });
  }
  return updates;
}

/** `name-version-release.arch` into its parts, or null. */
export function splitPackage(id: string): { name: string; version: string; arch: string } | null {
  if (id.length > 300 || /[\s;]/.test(id)) return null;
  const dot = id.lastIndexOf(".");
  if (dot < 1) return null;
  const arch = id.slice(dot + 1);
  if (!/^[A-Za-z0-9_]{2,16}$/.test(arch)) return null;
  const rest = id.slice(0, dot);
  const release = rest.lastIndexOf("-");
  const version = release < 1 ? -1 : rest.lastIndexOf("-", release - 1);
  if (version < 1) return null;
  return { name: rest.slice(0, version), version: rest.slice(version + 1), arch };
}

export interface SystemProgress {
  fraction: number | null;
  label: string;
}

const STATUS: Readonly<Record<string, string>> = {
  "waiting in queue": "Waiting",
  starting: "Starting",
  "downloading packages": "Downloading",
  download: "Downloading",
  "refreshing software list": "Checking",
  installing: "Installing",
  "installing updates": "Installing",
  running: "Working",
  finished: "Finishing",
  "waiting for authentication": "Waiting for your password",
  "loading cache": "Preparing",
  "testing changes": "Checking",
  "waiting for other software to finish": "Waiting",
};

/** The latest `Status:` and `Percentage:` lines (plain mode) of what `pkcon update` has printed. */
export function parseSystemProgress(output: string): SystemProgress | null {
  let status: string | null = null;
  let percent: number | null = null;
  for (const raw of output.split(/[\r\n]+/)) {
    const line = raw.trim();
    const s = line.match(/^Status:\s*(.+)$/i);
    if (s?.[1]) status = s[1].trim().toLowerCase();
    const p = line.match(/^Percentage:\s*(\d{1,3})\b/i);
    if (p?.[1]) percent = Math.min(Number(p[1]), 100);
  }
  if (status === null && percent === null) return null;
  const label =
    (status !== null && STATUS[status]) ||
    (status !== null
      ? tidy(
          status.replace(/^./, (c) => c.toUpperCase()),
          40,
        )
      : "Working");
  return { fraction: percent === null || (percent === 0 && status === "waiting in queue") ? null : percent / 100, label };
}

/**
 * pkcon can say it failed and still exit 0 ("Failed to contact PackageKit":
 * no daemon, no system bus), so its output is read too: the failure line, or
 * null when it reports none.
 */
export function pkconError(output: string): string | null {
  const line = output
    .split(/[\r\n]+/)
    .map((each) => each.trim())
    .find((each) => /^(Failed to |Command failed|Transaction failed|Error:)/i.test(each));
  return line === undefined ? null : tidy(line, 300);
}

/** The first `Command failed:` or error line of pkcon's output, else its last lines. */
export function systemFailure(output: string): string {
  const lines = output
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const failed = lines.filter((line) => /^(Command failed|Error|Failed|error:)/i.test(line) || /not authorized|authentication|denied/i.test(line));
  return tidy((failed.length > 0 ? failed.slice(-2) : lines.slice(-3)).join(" "), 400) || "The update did not finish.";
}

/** Package names whose update only takes hold after a restart: the kernel and the system's core libraries and services. */
const NEEDS_RESTART =
  /^(kernel(-core|-modules.*)?|kernel-.*|glibc(-.*)?|systemd(-.*)?|dbus(-broker|-daemon|-libs)?|linux-firmware|microcode_ctl|openssl-libs|gnutls)$/;

/** The updates after which the system should restart to finish. */
export function restartCauses(updates: readonly SystemUpdate[]): SystemUpdate[] {
  return updates.filter((update) => NEEDS_RESTART.test(update.name));
}

/**
 * `dnf needs-restarting -r` says "Reboot is required..." and exits 1 when a
 * restart is needed, "Reboot should not be necessary." and exits 0 when not.
 * Both the words and the status must agree: an error (no cache, no dnf) exits
 * nonzero too, and that is "not known" (null), never "restart".
 */
export function restartNeeded(code: number | null, output: string): boolean | null {
  if (code === 1 && /reboot is required|restart is required/i.test(output)) return true;
  if (code === 0 && /reboot should not be necessary/i.test(output)) return false;
  return null;
}
