/**
 * `.dashi-calendar.json` in the calendars folder: what the .ics files cannot
 * hold, which is which calendars the person has hidden in the app. It is read
 * as untrusted (people edit this folder by hand): anything of the wrong shape
 * is dropped. The shell reads it too, so the notification center's dots follow
 * the same checkboxes the app has. A hidden calendar still alerts.
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../../src/shared/fs/atomic.ts";
import { isCalendarId } from "./store.ts";

export const SIDECAR_FILE = ".dashi-calendar.json";

export interface Sidecar {
  version: 1;
  /** Calendar ids. */
  hidden: string[];
}

export const emptySidecar = (): Sidecar => ({ version: 1, hidden: [] });

export function parseSidecar(value: unknown): Sidecar {
  const out = emptySidecar();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const { hidden } = value as Record<string, unknown>;
  if (Array.isArray(hidden)) out.hidden = [...new Set(hidden.filter((id): id is string => isCalendarId(id)))].slice(0, 200);
  return out;
}

export function readSidecar(root: string): Sidecar {
  const path = join(root, SIDECAR_FILE);
  try {
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > 65_536) return emptySidecar();
    return parseSidecar(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptySidecar();
  }
}

export function writeSidecar(root: string, sidecar: Sidecar): void {
  writeAtomic(join(root, SIDECAR_FILE), `${JSON.stringify(sidecar, null, 2)}\n`);
}
