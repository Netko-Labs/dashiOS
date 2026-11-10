/**
 * The small JSON file next to the notes (`.dashi-notes.json` in the root) for
 * what Markdown can't hold: which notes are pinned, and where each note in
 * Recently Deleted came from and when it was deleted. It is read as untrusted
 * (people edit this folder by hand): anything of the wrong shape is dropped.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../fs/atomic.ts";

export const SIDECAR_FILE = ".dashi-notes.json";

export interface TrashEntry {
  /** The note id it had before it was deleted. */
  from: string;
  /** When it was deleted (ms since the epoch). */
  at: number;
}

export interface Sidecar {
  version: 1;
  /** Note ids. */
  pinned: string[];
  /** By file name inside Recently Deleted. */
  trash: Record<string, TrashEntry>;
}

export const emptySidecar = (): Sidecar => ({ version: 1, pinned: [], trash: {} });

/** `value` as a sidecar, keeping only what is well formed. */
export function parseSidecar(value: unknown): Sidecar {
  const out = emptySidecar();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.pinned)) out.pinned = [...new Set(record.pinned.filter((id): id is string => typeof id === "string" && id.length < 600))];
  const trash = record.trash;
  if (typeof trash === "object" && trash !== null && !Array.isArray(trash)) {
    for (const [file, entry] of Object.entries(trash)) {
      if (typeof entry !== "object" || entry === null) continue;
      const { from, at } = entry as Record<string, unknown>;
      if (typeof from === "string" && typeof at === "number" && Number.isFinite(at)) out.trash[file] = { from, at };
    }
  }
  return out;
}

export function readSidecar(root: string): Sidecar {
  const path = join(root, SIDECAR_FILE);
  if (!existsSync(path)) return emptySidecar();
  try {
    return parseSidecar(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptySidecar();
  }
}

export function writeSidecar(root: string, sidecar: Sidecar): void {
  writeAtomic(join(root, SIDECAR_FILE), `${JSON.stringify(sidecar, null, 2)}\n`);
}
