/**
 * The jobs that move files to the Trash, empty it, put files back and delete
 * them for good. A move to the Trash goes on the undo stack; the rest cannot
 * be taken back.
 */

import { baseName, deleteForever, emptyTrash, type FileItem, OpError, protectedReason, putBack, trashPaths } from "../../../files/index.ts";
import { quote, what } from "../wording.ts";
import type { JobHost } from "./job-host.ts";
import { trashAction } from "./undoable.ts";

const paths = (items: readonly FileItem[]): string[] => items.map((item) => item.path);

export async function trashFiles(host: JobHost, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const { home, dirs } = host.store.env;
  for (const path of paths) {
    const reason = protectedReason(
      path,
      home,
      dirs.map((dir) => dir.path),
    );
    if (reason) {
      host.store.say(reason, true);
      return;
    }
  }
  const trashed: string[] = [];
  const job = await host.jobs.run(`Moving ${what(paths)} to the Trash`, paths.length, async (ctx) => {
    const result = await trashPaths(paths, ctx, host.store.env.run);
    trashed.push(...result.trashed);
    if (result.failed.length > 0) {
      const first = result.failed[0] as { path: string; reason: string };
      throw new OpError(`${quote(baseName(first.path))} couldn’t be moved to the Trash: ${first.reason}`);
    }
    return `Moved ${what(paths)} to the Trash.`;
  });
  if (trashed.length > 0) host.undo.push(trashAction(trashed, host.undoEnv));
  host.finished(job.state, job.message, [], trashed.length > 0);
  host.store.select([]);
  host.store.reload();
}

export async function emptyTrashJob(host: JobHost): Promise<void> {
  const job = await host.jobs.run("Emptying the Trash", null, async () => {
    await emptyTrash(host.store.env.trash, host.store.env.run);
    return "The Trash is empty.";
  });
  host.finished(job.state, job.message, []);
  host.store.reload();
}

export async function putBackJob(host: JobHost, items: readonly FileItem[]): Promise<void> {
  const job = await host.jobs.run(`Putting back ${what(paths(items))}`, null, async () => {
    for (const item of items) await putBack(item.path, host.store.env.trash, host.store.env.home);
    return `Put back ${what(paths(items))}.`;
  });
  host.finished(job.state, job.message, []);
  host.store.reload();
}

export async function deleteForeverJob(host: JobHost, items: readonly FileItem[]): Promise<void> {
  const job = await host.jobs.run(`Deleting ${what(paths(items))}`, items.length, async (ctx) => {
    for (const item of items) {
      await deleteForever(item.path, host.store.env.trash);
      ctx.advance(1);
    }
    return `Deleted ${what(paths(items))}.`;
  });
  host.finished(job.state, job.message, []);
  host.store.select([]);
  host.store.reload();
}
