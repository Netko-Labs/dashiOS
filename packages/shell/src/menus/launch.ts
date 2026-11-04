/**
 * Starting things for the menus: another window of the focused app (File ›
 * New Window) and the help page (Help › Dashi Help).
 */

import { existsSync } from "node:fs";
import type { Entry } from "../entries.ts";

/** The launcher entry for the app whose windows report `appId`, if one is installed. */
export function findEntry(entries: readonly Entry[], appId: string): Entry | undefined {
  if (!appId) return undefined;
  const lower = appId.toLowerCase();
  return (
    entries.find((entry) => entry.id === appId) ??
    entries.find((entry) => entry.wmClass?.toLowerCase() === lower) ??
    entries.find((entry) => entry.id.toLowerCase() === lower)
  );
}

/** Dashi's README, which is the help until there is a manual. */
export const README = new URL("../../../../README.md", import.meta.url).pathname;

/** `xdg-open <readme>`, or null where either is missing (the row is then disabled). */
export function helpCommand(
  which: (program: string) => string | null = (program) => Bun.which(program),
  exists: (path: string) => boolean = existsSync,
): string[] | null {
  const opener = which("xdg-open");
  return opener && exists(README) ? [opener, README] : null;
}

/** Runs a command detached from the shell's input and output. */
export function spawnDetached(command: readonly string[]): void {
  try {
    Bun.spawn([...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch (error) {
    console.error(`dashi-shell: could not run ${command[0]}:`, error);
  }
}
