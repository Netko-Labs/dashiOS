/**
 * Copy or move files into a folder as a job, and what a taken name asks (PA-3):
 * Replace (the one there goes to the Trash), Keep Both ("name 2"), or Skip,
 * for one item or all of them. What was done goes on the undo stack.
 */

import { join } from "node:path";
import { copyInto, moveInto, OpError } from "../../src/shared/files/ops.ts";
import { baseName, isInside } from "../../src/shared/files/paths.ts";
import { trashPaths } from "../../src/shared/files/trashops.ts";
import { type Answer, type Resolution, type Side, sideOf } from "./conflicts.ts";
import { formatCount } from "./format.ts";
import type { JobHost } from "./job-host.ts";
import { measure } from "./size.ts";
import { copyAction, moveAction, withReplaced } from "./undoable.ts";
import { quote, what } from "./wording.ts";

/** What is already at the name `path` would take in `dest`; null when it is free, or it is the item itself (a copy into its own folder). */
async function taken(host: JobHost, path: string, dest: string): Promise<Side | null> {
  const target = join(dest, baseName(path));
  return target === path ? null : sideOf(target, host.store.env.mime);
}

/** Copy or move `paths` into `dest` as a job. Also what a drop would call. A taken name asks first (PA-3). */
export async function runTransfer(host: JobHost, paths: readonly string[], dest: string, mode: "copy" | "move"): Promise<string[]> {
  const created: string[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  /** What went to the Trash to make room (Replace): Undo puts it back. */
  const replaced: string[] = [];
  const verb = mode === "copy" ? "Copying" : "Moving";
  // An answer with "Apply to all" stands for the rest of this copy or move.
  let standing: Answer | null = null;
  await host.jobs
    .run(`${verb} ${what(paths)}`, null, async (ctx, job) => {
      if (mode === "copy") {
        let total = 0;
        for (const path of paths) total += (await measure(path, ctx.signal)).bytes;
        job.total = total;
      }
      const failures: string[] = [];
      for (const [index, path] of paths.entries()) {
        try {
          let resolution: Resolution = "keep-both";
          const existing = await taken(host, path, dest);
          if (existing && standing?.all) resolution = standing.resolution;
          else if (existing && host.ask) {
            const incoming = await sideOf(path, host.store.env.mime);
            if (incoming) {
              standing = await host.ask({ mode, incoming, existing, dest, remaining: paths.length - index - 1 });
              resolution = standing.resolution;
            }
          }
          if (resolution === "skip") continue;
          if (resolution === "replace") {
            const target = join(dest, baseName(path));
            if (isInside(target, path)) throw new OpError(`${quote(baseName(target))} can’t be replaced by something inside it.`);
            const out = await trashPaths([target], ctx, host.store.env.run);
            const failed = out.failed[0];
            if (failed) throw new OpError(`${quote(baseName(target))} couldn’t be moved to the Trash: ${failed.reason}`);
            replaced.push(target);
          }
          const made = mode === "copy" ? await copyInto(path, dest, ctx) : await moveInto(path, dest, ctx);
          if (made) created.push(made);
          if (made && mode === "move") moves.push({ from: path, to: made });
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
          failures.push(`${quote(baseName(path))}: ${error.message}`);
        }
        if (mode === "move") ctx.advance(1);
      }
      if (failures.length > 0) throw new OpError(failures.length === 1 ? (failures[0] as string) : `${failures.length} items failed. ${failures[0]}`);
      const went = mode === "copy" ? created : moves.map((move) => move.from);
      if (went.length === 0) return paths.length === 1 ? `Skipped ${what(paths)}.` : "Skipped them all.";
      return `${mode === "copy" ? "Copied" : "Moved"} ${what(went)}${replaced.length > 0 ? `, replacing ${formatCount(replaced.length)}` : ""}.`;
    })
    .then((job) => {
      // What was moved or copied before a failure or a Cancel can be taken back too, with what it replaced.
      const moved = mode === "move" && moves.length > 0;
      const copied = mode === "copy" && created.length > 0;
      if (moved) host.undo.push(withReplaced(moveAction(moves, host.undoEnv), replaced, host.undoEnv));
      if (copied) host.undo.push(withReplaced(copyAction("Copy", created, host.undoEnv), replaced, host.undoEnv));
      host.finished(job.state, job.message, created, moved || copied);
    });
  return created;
}
