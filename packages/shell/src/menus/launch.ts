/**
 * Starting things for the menus: another window of the focused app (File ›
 * New Window) and the help page (Help › Dashi Help).
 */

import { existsSync } from "node:fs";
import type { Entry } from "../entries.ts";
import { spawnDetached } from "../shared/process/detached.ts";

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

/** Help › Dashi Help: opens the README, when it and xdg-open are there. */
export function openHelp(): void {
  const command = helpCommand();
  if (command) spawnDetached(command);
}
