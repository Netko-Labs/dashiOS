/**
 * Compress to a zip next to the items, with `zip` (Info-ZIP) or `bsdtar`
 * (libarchive) when one is installed. Links are stored as links, never
 * followed, by either tool (`zip -y`; bsdtar's default). Names go in as
 * `./name`, so a file called `-r` is a name and not an option, and the program
 * runs in the items' folder, so the archive holds relative paths only.
 */

import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Exec, exec } from "../../../../src/shared/files/exec.ts";
import { Cancelled, type OpContext, OpError } from "../../../../src/shared/files/ops.ts";
import { baseName, checkName, parentOf, splitName, uniqueName } from "../../../../src/shared/files/paths.ts";
import type { Archiver } from "../../types.ts";

export function findArchiver(which: (program: string) => string | null = (program) => Bun.which(program)): Archiver | null {
  const zip = which("zip");
  if (zip) return { tool: "zip", path: zip };
  const bsdtar = which("bsdtar");
  return bsdtar ? { tool: "bsdtar", path: bsdtar } : null;
}

/** The archive's name: "Report.zip" for one item (extension dropped from a file), "Archive.zip" for several. */
export function archiveName(names: readonly string[]): string {
  if (names.length !== 1) return "Archive.zip";
  const only = names[0] as string;
  return `${splitName(only).stem || only}.zip`;
}

/** The command that makes `archive` (a file name in `cwd`) from `names` (plain names in `cwd`). */
export function archiveCommand(archiver: Archiver, archive: string, names: readonly string[]): string[] {
  const items = names.map((name) => `./${name}`);
  return archiver.tool === "zip" ? [archiver.path, "-r", "-y", "-q", archive, ...items] : [archiver.path, "--format", "zip", "-cf", archive, ...items];
}

/** Compresses `paths` (all in one folder) into a new zip there; its path. */
export async function compress(paths: readonly string[], archiver: Archiver, ctx: OpContext, run: Exec = exec): Promise<string> {
  const first = paths[0];
  if (!first) throw new OpError("Nothing to compress.");
  const dir = parentOf(first);
  if (paths.some((path) => parentOf(path) !== dir)) throw new OpError("Items from different folders can’t be compressed together.");
  const names = paths.map(baseName);
  const bad = names.find((name) => checkName(name) !== null);
  if (bad !== undefined) throw new OpError(`“${bad}” can’t be compressed.`);
  const name = uniqueName(archiveName(names), (candidate) => existsSync(join(dir, candidate)));
  // Written under a dot-name and renamed when whole, so a cancelled or failed run leaves no half archive under the real name.
  const partial = `.${name}`;
  const outcome = await run(archiveCommand(archiver, partial, names), { cwd: dir, signal: ctx.signal });
  if (ctx.signal.aborted) {
    await rm(join(dir, partial), { force: true });
    throw new Cancelled();
  }
  if (!outcome.ok) {
    await rm(join(dir, partial), { force: true });
    throw new OpError(outcome.stderr.trim().split("\n")[0] || "The archive couldn’t be made.");
  }
  await rename(join(dir, partial), join(dir, name));
  return join(dir, name);
}
