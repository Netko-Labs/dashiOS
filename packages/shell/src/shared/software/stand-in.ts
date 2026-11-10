/**
 * A stand-in for flatpak, pkcon, and dnf for checks that must not touch the
 * machine's software (`DASHI_SOFTWARE_FAKE=1`): a few installed apps, updates
 * waiting, and installs and updates that take a few seconds and report
 * progress. Only the package tools are faked; the catalog is the real Flathub.
 * Off unless the variable is set.
 */

import type { Runner } from "./lib/run.ts";
import type { ManagerDeps } from "./manager.ts";

const INSTALLED = [
  "org.gnome.Calculator\tCalculator\t51.1\tstable\tx86_64\tflathub\tuser\t5.1 MB\tPerform arithmetic, scientific or financial calculations",
  "org.mozilla.firefox\tFirefox\t140.0\tstable\tx86_64\tflathub\tsystem\t290.4 MB\tFast, Private & Safe Web Browser",
  "org.videolan.VLC\tVLC\t3.0.21\tstable\tx86_64\tflathub\tuser\t212.0 MB\tMultimedia player and streamer",
].join("\n");

const APP_UPDATES = {
  user: "org.videolan.VLC\tVLC\t3.0.22\tstable\tx86_64\tflathub\t34.2 MB",
  system: "org.mozilla.firefox\tFirefox\t141.0\tstable\tx86_64\tflathub\t58.9 MB",
};

const SYSTEM_UPDATES = [
  "Results:",
  "Security     kernel-core-6.12.6-200.fc44.x86_64 (updates)",
  "Bug fix      glibc-2.41-4.fc44.x86_64 (updates)",
  "Enhancement  gnome-text-editor-48.1-1.fc44.x86_64 (updates)",
  "Normal       mesa-dri-drivers-25.1.2-1.fc44.x86_64 (updates)",
  "",
].join("\n");

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const steps = async (ms: number, tick: (percent: number) => void, signal?: AbortSignal): Promise<void> => {
  for (let percent = 0; percent <= 100 && !signal?.aborted; percent += 10) {
    tick(percent);
    await sleep(ms / 10);
  }
};

/** The id's last word as a name ("org.kde.kalk" is "kalk"). */
const nameOf = (id: string): string => id.split(".").pop() ?? id;

/** What the stand-in has installed and removed since it started. */
const added = new Set<string>();
const removed = new Set<string>();
const updated = new Set<string>();

const run: Runner = async (command, options = {}) => {
  const [program, verb] = command;
  if (program === "flatpak" && verb === "list") {
    const rows = INSTALLED.split("\n").filter((row) => !removed.has(row.split("\t")[0] ?? ""));
    for (const id of added) rows.push(`${id}\t${nameOf(id)}\t1.0\tstable\tx86_64\tflathub\tuser\t12.0 MB\t`);
    return { code: 0, output: rows.join("\n") };
  }
  if (program === "flatpak" && verb === "remote-ls") {
    const row = command.includes("--user") ? APP_UPDATES.user : APP_UPDATES.system;
    return { code: 0, output: updated.has(row.split("\t")[0] ?? "") ? "" : row };
  }
  if (program === "flatpak" && verb === "remote-add") return { code: 0, output: "" };
  if (program === "flatpak" && verb === "uninstall") {
    const id = command[command.length - 1] ?? "";
    added.delete(id);
    removed.add(id);
    return { code: 0, output: "" };
  }
  if (program === "flatpak" && (verb === "install" || verb === "update")) {
    const word = verb === "install" ? "Installing" : "Updating";
    await steps(2500, (percent) => options.onOutput?.(`\r${word} 1/1… ${"█".repeat(percent / 10)} ${percent}%`), options.signal);
    if (process.env.DASHI_SOFTWARE_FAIL === "1" && !options.signal?.aborted) return { code: 1, output: "error: Failed to install: No space left on device\n" };
    if (verb === "update" && !options.signal?.aborted) {
      const id = command[command.length - 1] ?? "";
      if (command.length > 4) updated.add(id);
      else updated.add((command.includes("--user") ? APP_UPDATES.user : APP_UPDATES.system).split("\t")[0] ?? "");
    }
    if (verb === "install" && !options.signal?.aborted) {
      const id = command[command.length - 1] ?? "";
      removed.delete(id);
      added.add(id);
    }
    return { code: options.signal?.aborted ? 143 : 0, output: "" };
  }
  if (program === "pkcon" && verb === "get-updates") return { code: 0, output: SYSTEM_UPDATES };
  if (program === "pkcon" && (verb === "refresh" || command.includes("update"))) {
    await steps(3000, (percent) => options.onOutput?.(`Status: \tInstalling\nPercentage:\t${percent}\n`), options.signal);
    return { code: 0, output: "" };
  }
  if (program === "dnf") return { code: 1, output: "Reboot is required to fully utilize these updates.\n" };
  return { code: 127, output: `${program ?? "?"}: not available in the stand-in` };
};

/** The manager's dependencies for a stand-in run, or null for the real tools. */
export function standIn(env: Readonly<Record<string, string | undefined>> = process.env): ManagerDeps | null {
  if (env.DASHI_SOFTWARE_FAKE !== "1") return null;
  console.error("dashi-software: package tools are a stand-in here (DASHI_SOFTWARE_FAKE=1); nothing is installed");
  return { run, which: (program) => `/stand-in/${program}`, launch: () => {} };
}
