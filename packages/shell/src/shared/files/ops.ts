/**
 * Copy, move, duplicate, rename, and create: the operations that write.
 * Rules they keep:
 *  - Names are checked (`checkName`) and collisions become "name 2"; nothing
 *    is ever overwritten here (Replace moves the one there to the Trash first,
 *    operations.ts). Files are created exclusively and moves use
 *    `renameat2(RENAME_NOREPLACE)`, so a name taken in the meantime is a retry
 *    with the next name, never a replacement.
 *  - A symbolic link is copied as a link. A copy never reads through one, so a
 *    link inside a folder can't pull in (or write over) what it points at.
 *  - A folder can't go inside itself.
 *  - A cancelled copy removes the file it was in the middle of and stops.
 */

import { constants, lstatSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, open, readdir, readlink, rm, stat, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { isErrno } from "./errno.ts";
import { describeError } from "./items.ts";
import { renameNoReplace } from "./lib/noreplace.ts";
import { baseName, checkName, copyName, isInside, normalizePath, parentOf, uniqueName } from "./paths.ts";

export class Cancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

/** A failure with words for a person. */
export class OpError extends Error {}

export interface OpContext {
  signal: AbortSignal;
  /** `bytes` more are done. */
  advance(bytes: number): void;
}

export const quietContext = (signal: AbortSignal = new AbortController().signal): OpContext => ({ signal, advance() {} });

function checkCancelled(ctx: OpContext): void {
  if (ctx.signal.aborted) throw new Cancelled();
}

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false,
  );
const codeOf = (error: unknown): string | undefined => (isErrno(error) ? error.code : undefined);

/** Files at least this big are copied in chunks (cancellable, no symlink on open); smaller ones by the kernel's copy (reflinks where the disk can). */
const CHUNKED_FROM = 64 * 1024 * 1024;
const CHUNK = 1024 * 1024;

async function copyFileExclusive(src: string, dest: string, mode: number, size: number, mtime: Date, ctx: OpContext): Promise<void> {
  if (size < CHUNKED_FROM) {
    await copyFile(src, dest, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    ctx.advance(size);
  } else {
    // O_NOFOLLOW: if the source turned into a link since it was looked at, this fails rather than reading through it.
    const input = await open(src, constants.O_RDONLY | constants.O_NOFOLLOW);
    let output: Awaited<ReturnType<typeof open>> | null = null;
    try {
      output = await open(dest, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode & 0o777);
      const buffer = new Uint8Array(CHUNK);
      for (;;) {
        checkCancelled(ctx);
        const { bytesRead } = await input.read(buffer, 0, CHUNK, null);
        if (bytesRead === 0) break;
        await output.write(buffer, 0, bytesRead);
        ctx.advance(bytesRead);
      }
    } catch (error) {
      await output?.close().catch(() => {});
      output = null;
      // Only a file this call created is removed: an EEXIST means the name was someone else's.
      if (codeOf(error) !== "EEXIST") await rm(dest, { force: true });
      throw error;
    } finally {
      await input.close();
      await output?.close();
    }
  }
  await utimes(dest, mtime, mtime).catch(() => {});
}

/** Copies `src` (a file, a link, or a folder tree) to the free path `dest`. */
async function copyEntry(src: string, dest: string, ctx: OpContext): Promise<void> {
  checkCancelled(ctx);
  const info = await lstat(src);
  if (info.isSymbolicLink()) {
    await symlink(await readlink(src), dest);
  } else if (info.isDirectory()) {
    // Owner-only until it is full, so a read-only folder can still be filled.
    await mkdir(dest, { mode: 0o700 });
    try {
      for (const name of await readdir(src)) await copyEntry(join(src, name), join(dest, name), ctx);
    } catch (error) {
      if (error instanceof Cancelled) await rm(dest, { recursive: true, force: true });
      throw error;
    }
    await chmod(dest, info.mode & 0o7777).catch(() => {});
    await utimes(dest, info.mtime, info.mtime).catch(() => {});
  } else if (info.isFile()) {
    await copyFileExclusive(src, dest, info.mode, info.size, info.mtime, ctx);
  }
  // Sockets, pipes, and device nodes are not copied.
}

/** Runs `make(path)` on the first free name starting from `wanted`; a name that turns out taken moves on to the next. */
async function claim(destDir: string, wanted: string, make: (path: string) => Promise<void>): Promise<string> {
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = uniqueName(wanted, (candidate) => tried.has(candidate) || existsSyncLink(join(destDir, candidate)));
    tried.add(name);
    const path = join(destDir, name);
    try {
      await make(path);
      return path;
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error;
    }
  }
  throw new OpError(`Couldn’t find a free name for “${wanted}”.`);
}

function existsSyncLink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

async function checkSource(src: string, destDir: string): Promise<{ src: string; destDir: string }> {
  const from = normalizePath(src);
  const to = normalizePath(destDir);
  if (from === null || to === null) throw new OpError("That isn’t a valid path.");
  if (from === "/") throw new OpError("The root folder can’t be copied or moved.");
  const info = await lstat(from).catch((error) => {
    throw new OpError(describeError(error, from));
  });
  const target = await lstat(to).catch((error) => {
    throw new OpError(describeError(error, to));
  });
  // The destination may itself be reached through a link (a shortcut folder); what it points at must be a folder.
  const real = target.isSymbolicLink() ? await stat(to).catch(() => null) : target;
  if (!real?.isDirectory()) throw new OpError(`“${baseName(to)}” isn’t a folder.`);
  if (info.isDirectory() && isInside(from, to)) throw new OpError("A folder can’t be put inside itself.");
  return { src: from, destDir: to };
}

/** Copies `src` into `destDir` under a free name; the new path. */
export async function copyInto(src: string, destDir: string, ctx: OpContext, name: string = baseName(src)): Promise<string> {
  const checked = await checkSource(src, destDir);
  return claim(checked.destDir, name, (path) => copyEntry(checked.src, path, ctx));
}

/** A copy next to the original: "report copy.txt". */
export async function duplicate(src: string, ctx: OpContext): Promise<string> {
  const from = normalizePath(src);
  if (from === null) throw new OpError("That isn’t a valid path.");
  return copyInto(from, parentOf(from), ctx, copyName(baseName(from)));
}

/** Moves `src` into `destDir`; null when it is already there. Across disks it copies, then removes the original once the copy is whole. */
export async function moveInto(src: string, destDir: string, ctx: OpContext, name?: string): Promise<string | null> {
  const checked = await checkSource(src, destDir);
  if (name === undefined && parentOf(checked.src) === checked.destDir) return null;
  name ??= baseName(checked.src);
  try {
    return await claim(checked.destDir, name, (path) => renameNoReplace(checked.src, path));
  } catch (error) {
    if (codeOf(error) !== "EXDEV") throw error;
  }
  const copied = await claim(checked.destDir, name, (path) => copyEntry(checked.src, path, ctx));
  // `rm` removes a link itself, never what it points at.
  await rm(checked.src, { recursive: true, force: true });
  return copied;
}

/** Renames `path` to `newName` in the same folder; the new path. Refuses an existing name rather than replacing it. */
export async function renamePath(path: string, newName: string): Promise<string> {
  const from = normalizePath(path);
  const problem = checkName(newName);
  if (from === null) throw new OpError("That isn’t a valid path.");
  if (problem) throw new OpError(problem);
  if (baseName(from) === newName) return from;
  const to = join(parentOf(from), newName);
  try {
    await renameNoReplace(from, to);
  } catch (error) {
    throw new OpError(codeOf(error) === "EEXIST" ? `An item named “${newName}” already exists here.` : describeError(error, from));
  }
  return to;
}

/** A new folder called `name` in `dir`; an existing name is an error (the person typed it). */
export async function makeFolder(dir: string, name: string): Promise<string> {
  const base = normalizePath(dir);
  const problem = checkName(name);
  if (base === null) throw new OpError("That isn’t a valid path.");
  if (problem) throw new OpError(problem);
  const path = join(base, name);
  try {
    await mkdir(path);
  } catch (error) {
    throw new OpError(codeOf(error) === "EEXIST" ? `An item named “${name}” already exists here.` : describeError(error, path));
  }
  return path;
}

/** "untitled folder", the name a new folder starts with (then "untitled folder 2", …). */
export const NEW_FOLDER_NAME = "untitled folder";

/** The first free "untitled folder", "untitled folder 2", … in `dir`. */
export function freeName(dir: string, wanted: string): string {
  return uniqueName(wanted, (candidate) => existsSyncLink(join(dir, candidate)));
}

/** Whether something (even a dangling link) is at `path`. */
export { exists };
