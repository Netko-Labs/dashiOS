/** Writing a small text file so a reader never sees half of it: a temp file next to it, flushed, renamed over it. */

import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

let counter = 0;

export function writeTextAtomic(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${++counter}.tmp`);
  try {
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Never made, or already gone.
    }
    throw error;
  }
}
