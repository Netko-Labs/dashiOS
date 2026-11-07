/**
 * A file chooser's state, on Files' own browser (store.ts): where it stands,
 * what shows, the selection, search, the keys are all Files'. On top: the
 * filter (what may show), the save name, the app's choices, and the two
 * questions an answer can raise (a file that would be replaced, a name that
 * can't be). It opens on Recents for Open (the files lately used that the
 * app takes), unless the asker named a folder (it opens there) or Recents
 * has nothing for it (it opens Home instead of an empty list); in the save
 * folder for Save, and in the start folder when choosing folders. A save takes the name of a file picked; New Folder makes
 * "untitled folder" there and renames it in place, as in Files.
 */

import { useSyncExternalStore } from "react";
import type { Env } from "../env.ts";
import type { FileItem } from "../items.ts";
import { folderAt, type Location } from "../location.ts";
import { freeName, makeFolder, NEW_FOLDER_NAME, renamePath } from "../ops.ts";
import { parentOf } from "../paths.ts";
import { type FilesPrefs, readPrefs } from "../prefs.ts";
import { FilesStore } from "../store.ts";
import { accept, type Outcome, type Picked } from "./accept.ts";
import { passes } from "./filters.ts";
import type { ChooserAnswer, ChooserRequest, Filter } from "./request.ts";

export interface ChooserState {
  filter: Filter | null;
  name: string;
  choices: Record<string, string>;
  /** A file the save would replace, waiting for the person to say so. */
  replace: string | null;
  /** The person said Replace for this path. */
  replacing: string | null;
  problem: string | null;
}

/** A folder's name as the chooser shows it: Home for the home folder, Computer for the root. */
export const folderName = (path: string, home: string): string => (path === home ? "Home" : path === "/" ? "Computer" : path.split("/").pop() || path);

/** The folder pop-up's rows: `path` itself, then each folder it is in, up to the root. */
export function folderTrail(path: string, home: string): Array<{ name: string; path: string }> {
  const trail: Array<{ name: string; path: string }> = [];
  let at = path;
  for (let guard = 0; guard < 64; guard++) {
    trail.push({ name: folderName(at, home), path: at });
    const parent = parentOf(at);
    if (parent === at) break;
    at = parent;
  }
  return trail;
}

/** Whether a chooser for `request` with `filter` shows `item`: folders always (a way through), files when it takes files and the filter lets them by. */
export function chooserShows(request: Pick<ChooserRequest, "directory">, filter: Filter | null, item: Pick<FileItem, "kind" | "name" | "mime">): boolean {
  if (item.kind === "folder") return true;
  if (item.kind !== "file") return false;
  return !request.directory && passes(filter, item.name, item.mime);
}

export interface ChooserOptions {
  /** The view and sort Files was left with (prefs.ts); by default read from Files' settings. */
  prefs?: FilesPrefs;
  watch?: boolean;
}

export class ChooserModel {
  readonly store: FilesStore;
  private state: ChooserState;
  private readonly listeners = new Set<() => void>();
  /** The folder last shown: where a save from Recents or a search goes. */
  private lastFolder: string;
  private picked: string | null = null;
  /** Opened on Recents, not listed yet: an empty list gives way to Home. */
  private recentsUnseen: boolean;
  /** What Open (a double-click, Return) asks the window to do; the view sets it. */
  onAccept: (() => void) | null = null;

  constructor(
    readonly request: ChooserRequest,
    env: Env,
    start: { folder: string; name: string },
    options: ChooserOptions = {},
  ) {
    const prefs = options.prefs ?? readPrefs();
    const recentsFirst = request.mode === "open" && !request.directory && request.currentFolder === null && request.currentFile === null;
    const location: Location = recentsFirst ? { kind: "recents" } : folderAt(start.folder);
    this.recentsUnseen = recentsFirst;
    this.lastFolder = start.folder;
    this.state = {
      filter: request.currentFilter,
      name: start.name,
      choices: Object.fromEntries(request.choices.map((choice) => [choice.id, choice.initial])),
      replace: null,
      replacing: null,
      problem: null,
    };
    this.store = new FilesStore(env, location, {
      watch: options.watch ?? true,
      shows: (item) => chooserShows(this.request, this.state.filter, item),
      openFiles: () => this.onAccept?.(),
      // Files' view, sort and Show Hidden; the chooser changes them for itself only.
      prefs: { read: () => prefs, write: () => {} },
    });
    this.store.renamer = async (path, name) => {
      try {
        const renamed = await renamePath(path, name);
        this.store.reload();
        this.store.select([renamed]);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    this.store.subscribe(() => this.follow());
  }

  start(): void {
    this.store.start();
  }

  stop(): void {
    this.store.stop();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChooserState => this.state;

  get home(): string {
    return this.store.env.home;
  }

  private set(patch: Partial<ChooserState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The folder shown, else null (Recents, a search's results). */
  folder(): string | null {
    const { location, found } = this.store.getSnapshot();
    return location.kind === "folder" && found === null ? location.path : null;
  }

  /** Keeps up with the browser: the last folder shown, and a save takes the name of a file picked. */
  private follow(): void {
    const { location, selection, loading, listed } = this.store.getSnapshot();
    if (this.recentsUnseen && !loading && listed.kind === "recents") {
      this.recentsUnseen = false;
      // Nothing lately used that this chooser takes: Home, not an empty list (no Back to it either).
      if (location.kind === "recents" && this.store.visible().length === 0) return this.store.go(folderAt(this.home), { record: false });
    }
    if (location.kind === "folder") this.lastFolder = location.path;
    const one = selection.length === 1 ? selection[0] : undefined;
    if (one === this.picked) return;
    this.picked = one ?? null;
    if (this.state.replace !== null || this.state.problem !== null) this.set({ replace: null, problem: null, replacing: null });
    if (this.request.mode !== "save" || one === undefined) return;
    const item = this.store.selectedItems()[0];
    if (item && item.kind !== "folder" && item.name !== this.state.name) this.set({ name: item.name });
  }

  selected(): Picked[] {
    return this.store.selectedItems().map((item) => ({ path: item.path, folder: item.kind === "folder" }));
  }

  setFilter(filter: Filter | null): void {
    this.set({ filter });
    this.store.refilter();
  }

  setName(name: string): void {
    this.set({ name, replace: null, replacing: null, problem: null });
  }

  setChoice(id: string, value: string): void {
    this.set({ choices: { ...this.state.choices, [id]: value } });
  }

  /** The person said Replace for the file asked about. */
  confirmReplace(): void {
    if (this.state.replace) this.set({ replacing: this.state.replace, replace: null });
  }

  /** A problem to show under the name row (a typed path that leads nowhere), or null to take it down. */
  say(problem: string | null): void {
    if (problem !== this.state.problem) this.set({ problem });
  }

  dismiss(): void {
    this.set({ replace: null, problem: null });
  }

  /** What Open or Save means now (accept.ts), with the question it raises shown. */
  decide(exists: (path: string) => boolean): Outcome {
    const outcome = accept(
      this.request,
      { folder: this.folder(), saveFolder: this.lastFolder, selected: this.selected(), name: this.state.name, replacing: this.state.replacing },
      exists,
    );
    if (outcome.kind === "open-folder") this.store.go(folderAt(outcome.path));
    else if (outcome.kind === "replace") this.set({ replace: outcome.path, problem: null });
    else if (outcome.kind === "problem") this.set({ problem: outcome.text, replace: null });
    return outcome;
  }

  /** The answer for `paths`, with the choices and filter as they stand. */
  answer(paths: string[]): ChooserAnswer {
    return { paths, choices: Object.entries(this.state.choices), filter: this.state.filter };
  }

  /** Whether a folder can be made where the chooser stands. */
  canMakeFolder(): boolean {
    return this.request.mode !== "open" || this.request.directory ? this.folder() !== null : false;
  }

  /** New Folder (when saving or choosing a folder): "untitled folder" here, its name a field. */
  async newFolder(): Promise<void> {
    const dir = this.folder();
    if (dir === null) return;
    try {
      const made = await makeFolder(dir, freeName(dir, NEW_FOLDER_NAME));
      this.store.reload();
      this.store.startRename(made);
    } catch (error) {
      this.set({ problem: error instanceof Error ? error.message : String(error) });
    }
  }
}

export function useChooser(model: ChooserModel): ChooserState {
  return useSyncExternalStore(model.subscribe, model.getSnapshot);
}
