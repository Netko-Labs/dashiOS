/**
 * The things Files does to files, as the window triggers them: each turns
 * the selection into a job (progress and Cancel in the footer), runs the
 * checked operations from ops.ts, trashops.ts, and archive.ts, and reports
 * the outcome in the footer. Nothing here touches the disk directly. Each
 * write that worked goes on the undo stack (undoable.ts): Edit › Undo and
 * the notice's Undo take it back. A copy or a move onto a name that is taken
 * asks first (PA-3): Replace (the one there goes to the Trash), Keep Both
 * ("name 2"), or Skip, for one item or all of them.
 */

import { UndoStack } from "@dashi/ui";
import {
  appsFor,
  baseName,
  duplicate,
  type FileItem,
  freeName,
  isInside,
  makeFolder,
  NEW_FOLDER_NAME,
  OpError,
  type OpenWithApp,
  openWith,
  parentOf,
  renamePath,
} from "../files/index.ts";
import type { Answer, Conflict } from "./conflicts.ts";
import { Jobs } from "./jobs.ts";
import { type DropKeys, dropChoice } from "./lib/drag.ts";
import { eject, mount } from "./lib/drives.ts";
import type { Volume } from "./lib/mounts.ts";
import { compress } from "./lib/operations/archive.ts";
import type { JobHost } from "./lib/operations/job-host.ts";
import { runTransfer } from "./lib/operations/transfer.ts";
import { deleteForeverJob, emptyTrashJob, putBackJob, trashFiles } from "./lib/operations/trash-jobs.ts";
import { copyAction, newFolderAction, renameAction, type UndoEnv } from "./lib/operations/undoable.ts";
import { quote, what } from "./lib/wording.ts";
import type { FilesStore } from "./store.ts";

export class Operations implements JobHost {
  readonly jobs = new Jobs();
  /** What Edit › Undo takes back: Files' writes, newest last. */
  readonly undo = new UndoStack();

  /**
   * Asks about a name collision (the window's conflict sheet). Without it a
   * collision keeps both, as Files did before it asked (agents, tests).
   */
  ask: ((conflict: Conflict) => Promise<Answer>) | null = null;

  constructor(readonly store: FilesStore) {
    store.renamer = (path, name) => this.rename(path, name);
    // A notice's Undo is for its own step: once Undo would take back another
    // (it was undone, or a rename or a new folder came after), the notice goes.
    this.undo.subscribe(() => {
      const step = this.store.getSnapshot().notice?.undoStep;
      if (step !== undefined && step !== this.undo.state.undoStep) this.store.dismissNotice();
    });
  }

  get undoEnv(): UndoEnv {
    const { trash, home, run } = this.store.env;
    return {
      trash,
      home,
      run,
      refresh: (paths) => {
        this.store.reload();
        const here = this.here;
        this.store.select(paths.filter((path) => here !== null && parentOf(path) === here));
      },
    };
  }

  /**
   * Edit › Undo or Redo, or the notice's Undo: a step that fails says why.
   * One that didn't run (another still running, or none to take) leaves the
   * notice where it is.
   */
  async undoStep(way: "undo" | "redo"): Promise<void> {
    try {
      if (await (way === "undo" ? this.undo.undo() : this.undo.redo())) this.store.dismissNotice();
    } catch (error) {
      this.store.say(error instanceof Error ? error.message : String(error), true);
    }
  }

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

  /** Copy or move `paths` into `dest` as a job. Also what a drop would call. A taken name asks first (PA-3). */
  transfer(paths: readonly string[], dest: string, mode: "copy" | "move"): Promise<string[]> {
    return runTransfer(this, paths, dest, mode);
  }

  async duplicateSelection(): Promise<void> {
    const paths = this.paths();
    const created: string[] = [];
    const job = await this.jobs.run(`Duplicating ${what(paths)}`, null, async (ctx) => {
      for (const path of paths) created.push(await duplicate(path, ctx));
    });
    if (created.length > 0) this.undo.push(copyAction("Duplicate", created, this.undoEnv));
    this.finished(job.state, job.message, created, created.length > 0);
  }

  // --- Making and renaming -----------------------------------------------------------

  /**
   * File › New Folder: "untitled folder" (or the first free "untitled folder
   * 2", …) at once, selected, its name a field to type over. The folder's
   * path, or an error to show.
   */
  async newFolder(): Promise<{ path: string } | { error: string }> {
    const dir = this.here;
    if (dir === null || !this.writable) return { error: "A folder can’t be made here." };
    try {
      const made = await makeFolder(dir, freeName(dir, NEW_FOLDER_NAME));
      this.undo.push(newFolderAction(made, this.undoEnv));
      this.store.reload();
      this.store.startRename(made);
      return { path: made };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.store.say(text, true);
      return { error: text };
    }
  }

  /** Renames `path` to `name`; an error to show, or null. The renamed item stays selected unless the selection moved on meanwhile. */
  async rename(path: string, name: string): Promise<string | null> {
    try {
      const renamed = await renamePath(path, name);
      if (renamed !== path) this.undo.push(renameAction(path, renamed, this.undoEnv));
      this.store.reload();
      const { selection } = this.store.getSnapshot();
      if (selection.length === 0 || (selection.length === 1 && selection[0] === path)) this.store.select([renamed]);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  // --- Trash -------------------------------------------------------------------------

  async trash(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    await this.trashFiles(this.paths(items));
  }

  /**
   * Files dropped on the folder `dest` (drag.ts says move or copy), or on
   * the Trash. Dropped on the folder they're in, without a key, nothing.
   */
  async drop(paths: readonly string[], dest: string | "trash", keys: DropKeys): Promise<void> {
    if (dest === "trash") {
      const outside = paths.filter((path) => !isInside(this.store.env.trash.files, path));
      if (outside.length > 0) await this.trashFiles(outside);
      return;
    }
    const choice = dropChoice(paths, dest, keys);
    if (choice) await this.transfer(choice.paths, dest, choice.mode);
  }

  private async trashFiles(paths: readonly string[]): Promise<void> {
    await trashFiles(this, paths);
  }

  async emptyTrash(): Promise<void> {
    await emptyTrashJob(this);
  }

  async putBack(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    await putBackJob(this, items);
  }

  async deleteForever(items: readonly FileItem[] = this.store.selectedItems()): Promise<void> {
    await deleteForeverJob(this, items);
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
    if (created.length > 0) this.undo.push(copyAction("Compress", created, this.undoEnv));
    this.finished(job.state, job.message, created, created.length > 0);
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

  /** `undoable`: a step was just pushed, and the notice offers Undo for it (and only it). */
  finished(state: string, message: string | null, created: readonly string[], undoable = false): void {
    if (state === "cancelled") this.store.say("Cancelled.");
    else if (state === "failed") this.store.say(message ?? "Something went wrong.", true);
    else if (message) this.store.say(message, false, undoable ? this.undo.state.undoStep : null);
    this.store.reload();
    const here = this.here;
    const mine = created.filter((path) => here !== null && parentOf(path) === here);
    if (mine.length > 0) this.store.select(mine);
  }
}
