/**
 * The things Files does to files, as the window triggers them: each turns
 * the selection into a job (progress and Cancel in the footer), runs the
 * checked operations from ops.ts, trashops.ts, and archive.ts, and reports
 * the outcome in the footer. Nothing here touches the disk directly.
 */

import { compress } from "./archive.ts";
import { eject, mount } from "./drives.ts";
import type { FileItem } from "./items.ts";
import { Jobs } from "./jobs.ts";
import { copyInto, duplicate, makeFolder, moveInto, OpError, renamePath } from "./ops.ts";
import { appsFor, openWith, type OpenWithApp } from "./open.ts";
import { baseName, isInside, parentOf } from "./paths.ts";
import { measure } from "./size.ts";
import type { FilesStore } from "./store.ts";
import { deleteForever, emptyTrash, protectedReason, putBack, trashPaths } from "./trashops.ts";
import { formatCount } from "./format.ts";
import type { Volume } from "./mounts.ts";

const quote = (name: string): string => `“${name}”`;

/** "3 items" or "“a.txt”". */
const what = (paths: readonly string[]): string => (paths.length === 1 ? quote(baseName(paths[0] as string)) : formatCount(paths.length));

export class Operations {
  readonly jobs = new Jobs();

  constructor(private readonly store: FilesStore) {}

  private get here(): string | null {
    const { location } = this.store.getSnapshot();
    return location.kind === "folder" ? location.path : null;
  }

  /** Whether the current folder is somewhere things can be created or pasted (not Recents or the Trash). */
  get writable(): boolean {
    const { location } = this.store.getSnapshot();
    return location.kind === "folder" && !isInside(this.store.env.trash.files, location.path);
  }

  private paths(items: readonly FileItem[] = this.store.selectedItems()): string[] {
    return items.map((item) => item.path);
  }

  // --- Clipboard ---------------------------------------------------------------------

  copy(items?: readonly FileItem[]): void {
    this.hold(this.paths(items), false);
  }

  cut(items?: readonly FileItem[]): void {
    this.hold(this.paths(items), true);
  }

  private hold(paths: string[], cut: boolean): void {
    if (paths.length === 0) return;
    this.store.patch({ clipboard: { paths, cut } });
    // The desktop's clipboard gets the files too, when wl-clipboard is there, so other apps can paste them.
    void this.store.env.clipboard.write(paths).then((shared) => {
      if (!shared && !this.store.env.clipboard.canWrite)
        this.store.say(`${cut ? "Cut" : "Copied"} ${what(paths)} for pasting in Files. Install wl-clipboard to paste into other apps.`);
    });
  }

  /** Paste into the current folder: what the system clipboard holds (from any file manager), else what Files itself holds. */
  async paste(): Promise<void> {
    const dest = this.here;
    if (dest === null || !this.writable) return;
    const own = this.store.getSnapshot().clipboard;
    const system = await this.store.env.clipboard.read();
    // Our own copy is on the system clipboard too (as copy, whatever it was): Files remembers if it was a cut.
    const same = system && own && system.paths.length === own.paths.length && system.paths.every((path) => own.paths.includes(path));
    const source = system ? { paths: system.paths, cut: same ? own.cut : system.cut } : own;
    if (!source || source.paths.length === 0) {
      this.store.say("There is nothing to paste.");
      return;
    }
    await this.transfer(source.paths, dest, source.cut ? "move" : "copy");
    if (source.cut) this.store.patch({ clipboard: null });
  }

  /** Copy or move `paths` into `dest` as a job. Also what a drop would call. */
  async transfer(paths: readonly string[], dest: string, mode: "copy" | "move"): Promise<string[]> {
    const created: string[] = [];
    const verb = mode === "copy" ? "Copying" : "Moving";
    await this.jobs
      .run(`${verb} ${what(paths)}`, null, async (ctx, job) => {
        if (mode === "copy") {
          let total = 0;
          for (const path of paths) total += (await measure(path, ctx.signal)).bytes;
          job.total = total;
        }
        const failures: string[] = [];
        for (const path of paths) {
          try {
            const made = mode === "copy" ? await copyInto(path, dest, ctx) : await moveInto(path, dest, ctx);
            if (made) created.push(made);
          } catch (error) {
            if (!(error instanceof OpError)) throw error;
            failures.push(`${quote(baseName(path))}: ${error.message}`);
          }
          if (mode === "move") ctx.advance(1);
        }
        if (failures.length > 0) throw new OpError(failures.length === 1 ? (failures[0] as string) : `${failures.length} items failed. ${failures[0]}`);
        return `${mode === "copy" ? "Copied" : "Moved"} ${what(paths)}.`;
      })
      .then((job) => this.finished(job.state, job.message, created));
    return created;
  }

  async duplicateSelection(): Promise<void> {
    const paths = this.paths();
    const created: string[] = [];
    const job = await this.jobs.run(`Duplicating ${what(paths)}`, null, async (ctx) => {
      for (const path of paths) created.push(await duplicate(path, ctx));
    });
    this.finished(job.state, job.message, created);
  }

  // --- Making and renaming -----------------------------------------------------------

  /** Make a folder here; an error to show in the sheet, or null. */
  async newFolder(name: string): Promise<string | null> {
    const dir = this.here;
    if (dir === null || !this.writable) return "A folder can’t be made here.";
    try {
      const made = await makeFolder(dir, name);
      this.store.reload();
      this.store.select([made]);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async rename(path: string, name: string): Promise<string | null> {
    try {
      const renamed = await renamePath(path, name);
      this.store.reload();
      this.store.select([renamed]);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // --- Trash -------------------------------------------------------------------------

  async trash(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    const paths = this.paths(items);
    const { home, dirs } = this.store.env;
    for (const path of paths) {
      const reason = protectedReason(
        path,
        home,
        dirs.map((dir) => dir.path),
      );
      if (reason) {
        this.store.say(reason, true);
        return;
      }
    }
    const job = await this.jobs.run(`Moving ${what(paths)} to the Trash`, paths.length, async (ctx) => {
      const result = await trashPaths(paths, ctx, this.store.env.run);
      if (result.failed.length > 0) {
        const first = result.failed[0] as { path: string; reason: string };
        throw new OpError(`${quote(baseName(first.path))} couldn’t be moved to the Trash: ${first.reason}`);
      }
      return `Moved ${what(paths)} to the Trash.`;
    });
    this.finished(job.state, job.message, []);
    this.store.select([]);
    this.store.reload();
  }

  async emptyTrash(): Promise<void> {
    const job = await this.jobs.run("Emptying the Trash", null, async () => {
      await emptyTrash(this.store.env.trash, this.store.env.run);
      return "The Trash is empty.";
    });
    this.finished(job.state, job.message, []);
    this.store.reload();
  }

  async putBack(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    const job = await this.jobs.run(`Putting back ${what(this.paths(items))}`, null, async () => {
      for (const item of items) await putBack(item.path, this.store.env.trash, this.store.env.home);
      return `Put back ${what(this.paths(items))}.`;
    });
    this.finished(job.state, job.message, []);
    this.store.reload();
  }

  async deleteForever(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    const job = await this.jobs.run(`Deleting ${what(this.paths(items))}`, items.length, async (ctx) => {
      for (const item of items) {
        await deleteForever(item.path, this.store.env.trash);
        ctx.advance(1);
      }
      return `Deleted ${what(this.paths(items))}.`;
    });
    this.finished(job.state, job.message, []);
    this.store.select([]);
    this.store.reload();
  }

  // --- Archive, open with, volumes ---------------------------------------------------

  get canCompress(): boolean {
    return this.store.env.archiver !== null;
  }

  async compress(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    const archiver = this.store.env.archiver;
    if (!archiver) {
      this.store.say("Install zip or bsdtar to make archives.", true);
      return;
    }
    const created: string[] = [];
    const job = await this.jobs.run(`Compressing ${what(this.paths(items))}`, null, async (ctx) => {
      created.push(await compress(this.paths(items), archiver, ctx, this.store.env.run));
      return `Made ${quote(baseName(created[0] as string))}.`;
    });
    this.finished(job.state, job.message, created);
  }

  appsFor(item: FileItem): Promise<OpenWithApp[]> {
    return appsFor(item.mime, this.store.env.run);
  }

  async openWith(app: OpenWithApp, item: FileItem): Promise<void> {
    const problem = await openWith(app, item.path, this.store.env.run);
    if (problem) this.store.say(`${app.name} couldn’t open ${quote(item.name)}: ${problem}`, true);
  }

  async ejectVolume(volume: Volume): Promise<void> {
    const job = await this.jobs.run(`Ejecting ${quote(volume.name)}`, null, async () => {
      const problem = await eject(volume, this.store.env.run);
      if (problem) throw new OpError(problem);
      return `${quote(volume.name)} can be removed.`;
    });
    this.finished(job.state, job.message, []);
    const { location } = this.store.getSnapshot();
    if (volume.mountPoint && location.kind === "folder" && isInside(volume.mountPoint, location.path))
      this.store.go({ kind: "folder", path: this.store.env.home });
    void this.store.refreshVolumes();
  }

  async mountVolume(volume: Volume): Promise<void> {
    const result = await mount(volume, this.store.env.run);
    await this.store.refreshVolumes();
    if ("error" in result) this.store.say(result.error, true);
    else this.store.go({ kind: "folder", path: result.path });
  }

  // --- Outcomes ----------------------------------------------------------------------

  private finished(state: string, message: string | null, created: readonly string[]): void {
    if (state === "cancelled") this.store.say("Cancelled.");
    else if (state === "failed") this.store.say(message ?? "Something went wrong.", true);
    else if (message) this.store.say(message);
    this.store.reload();
    const here = this.here;
    const mine = created.filter((path) => here !== null && parentOf(path) === here);
    if (mine.length > 0) this.store.select(mine);
  }
}
