/**
 * Writing the settings file: read-modify-write on the file as it is now, so
 * keys the writer does not know survive, and atomic (a temp file in the same
 * directory, flushed, then renamed over the file), so a crash never leaves
 * half a file for the shell's watcher to read. System Settings' store
 * (settings-app/store.ts) writes through it, and so does Software for the
 * applet catalogs the person added (applet-store/catalog-set.ts).
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { dig, isRaw, type Raw } from "./file.ts";

let temporaries = 0;

/**
 * Write `value` as `path` atomically: a temp file next to it, flushed, then
 * renamed over it. A failure leaves the old file as it was.
 */
export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${process.pid}.${++temporaries}.tmp`);
  try {
    const fd = openSync(temp, "w", 0o600);
    try {
      writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
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

/** The object at `path`, made (replacing anything that is not an object) when it is not there. */
export function ensure(root: Raw, path: readonly string[]): Raw {
  let at = root;
  for (const key of path) {
    const next = at[key];
    if (isRaw(next)) {
      at = next;
    } else {
      const made: Raw = {};
      at[key] = made;
      at = made;
    }
  }
  return at;
}

/** Remove `path`'s object if it ended up empty, and then its emptied parents. */
export function prune(root: Raw, path: readonly string[]): void {
  for (let depth = path.length; depth > 0; depth--) {
    const parent = dig(root, path.slice(0, depth - 1));
    if (!parent) return;
    const key = path[depth - 1] as string;
    const child = parent[key];
    if (isRaw(child) && Object.keys(child).length === 0) delete parent[key];
    else return;
  }
}

/**
 * The object to edit at `path`. A file that is not valid JSON (or not an
 * object) is moved to `settings.json.invalid` before it is replaced, so
 * hand-written content is never silently thrown away.
 */
function rootForWrite(path: string): Raw {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  try {
    const value: unknown = JSON.parse(text);
    if (isRaw(value)) return value;
  } catch {
    // Handled below.
  }
  renameSync(path, `${path}.invalid`);
  console.error(`dashi-shell: ${path} was not a JSON object; kept as ${basename(path)}.invalid`);
  return {};
}

/** Apply `edit` to the file at `path` as it is now and save the result, which it returns; throws when it can't be saved. */
export function updateSettingsFile(path: string, edit: (root: Raw) => void): Raw {
  const root = rootForWrite(path);
  edit(root);
  writeJsonAtomic(path, root);
  return root;
}
