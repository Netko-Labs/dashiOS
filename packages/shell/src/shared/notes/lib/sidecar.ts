/**
 * The small JSON file next to the notes (`.dashi-notes.json` in the root) for
 * what Markdown can't hold: which notes are pinned, and where each note in
 * Recently Deleted came from and when it was deleted. It is read as untrusted
 * (people edit this folder by hand): anything of the wrong shape is dropped.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lenientList, maybe, num, obj, record, refine, str, unknown } from "@dashi/shape";
import { writeAtomic } from "../../fs/index.ts";

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

const LOOSE = { strict: false } as const;

/** The note ids in Pinned: text under 600 characters; any other entry is dropped. */
const PinnedIds = lenientList(refine(str(), (id) => (id.length < 600 ? null : "a note id is too long")));

/** One Recently Deleted entry: where it was and when it was deleted; an entry without both is dropped. */
const TrashEntry = obj({ from: str(), at: num() }, LOOSE);

/** `value` as a sidecar, keeping only what is well formed. */
export function parseSidecar(value: unknown): Sidecar {
  const out = emptySidecar();
  const fields = maybe(obj({ pinned: unknown(), trash: unknown() }, LOOSE), value);
  if (!fields) return out;
  out.pinned = [...new Set(maybe(PinnedIds, fields.pinned) ?? [])];
  for (const [file, entry] of Object.entries(maybe(record(unknown()), fields.trash) ?? {})) {
    const parsed = maybe(TrashEntry, entry);
    if (parsed) out.trash[file] = parsed;
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

/** Reads the sidecar, lets `change` edit it, and writes it back. */
export function updateSidecar(root: string, change: (sidecar: Sidecar) => void): void {
  const sidecar = readSidecar(root);
  change(sidecar);
  writeSidecar(root, sidecar);
}
