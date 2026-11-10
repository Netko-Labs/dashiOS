/**
 * Reading note files: which directory entries are notes, and the parsed notes,
 * cached while a file's size and mtime hold, so a scan reads only what changed.
 */

import { type Dirent, readFileSync, statSync } from "node:fs";
import { isRegularFile } from "../fs/index.ts";
import { noteId } from "./names.ts";
import { parseNote } from "./text.ts";
import { MAX_NOTE_BYTES, type Note } from "./types.ts";

export const isNoteFile = (entry: Dirent): boolean => entry.isFile() && !entry.name.startsWith(".") && /\.md$/i.test(entry.name);

export class NoteCache {
  /** Parsed files by path, valid while their size and mtime hold. */
  private readonly entries = new Map<string, { mtimeMs: number; size: number; text: ReturnType<typeof parseNote> }>();

  /** The note at `path`, a file named `file` in `folder`, as it is now; null when it is not a readable note file. */
  load(path: string, folder: string, file: string, pinned: ReadonlySet<string>): Note | null {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      return null;
    }
    if (!isRegularFile(path) || stat.size > MAX_NOTE_BYTES) return null;
    let cached = this.entries.get(path);
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      try {
        cached = { mtimeMs: stat.mtimeMs, size: stat.size, text: parseNote(readFileSync(path, "utf8")) };
      } catch {
        return null;
      }
      this.entries.set(path, cached);
    }
    const id = noteId(folder, file);
    const { title, body, heading } = cached.text;
    return {
      id,
      folder,
      title,
      body,
      heading,
      modified: stat.mtimeMs,
      created: stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
      pinned: pinned.has(id),
    };
  }

  /** Drops the cached note at `path` (it was renamed or removed). */
  forget(path: string): void {
    this.entries.delete(path);
  }
}
