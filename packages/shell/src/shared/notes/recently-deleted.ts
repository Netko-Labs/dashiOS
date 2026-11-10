/**
 * Recently Deleted: the folder `.Recently Deleted` in the notes root, where a
 * deleted note waits. store.ts moves notes in and out; this lists them.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isNoteFile } from "./read-note.ts";
import type { Sidecar } from "./sidecar.ts";
import { parseNote } from "./text.ts";
import { type DeletedNote, MAX_NOTE_BYTES } from "./types.ts";

export const TRASH_DIR = ".Recently Deleted";

/** The notes in Recently Deleted, the latest deleted first. */
export function listDeleted(root: string, sidecar: Sidecar): DeletedNote[] {
  const dir = join(root, TRASH_DIR);
  if (!existsSync(dir)) return [];
  const out: DeletedNote[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!isNoteFile(entry)) continue;
    try {
      const path = join(dir, entry.name);
      const stat = statSync(path);
      if (stat.size > MAX_NOTE_BYTES) continue;
      const meta = sidecar.trash[entry.name];
      out.push({
        id: entry.name,
        ...parseNote(readFileSync(path, "utf8")),
        modified: stat.mtimeMs,
        from: meta?.from ?? entry.name,
        deletedAt: meta?.at ?? stat.ctimeMs,
      });
    } catch {
      // Gone while reading.
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}
