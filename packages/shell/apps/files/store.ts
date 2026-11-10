/**
 * The state of one Files window and what moves it: where it is looking
 * (with back and forward), what is listed and how it is sorted, the
 * selection, search, and the volumes in the sidebar. It is a plain store
 * (`subscribe`/`getSnapshot`) the React views read with
 * `useSyncExternalStore`. Operations that write (copy, trash, rename…) are
 * in operations.ts and report through here. It is the file browser's core:
 * Files' window and every chooser (chooser/) run on it, a chooser with a
 * filter on what shows and its own idea of opening a file.
 */

import type { SortState } from "@dashi/ui";
import type { Modifiers } from "@mirinjs/metal";
import type { FileItem } from "../../src/shared/files/items.ts";
import { loadVolumes } from "./drives.ts";
import type { Env } from "./env.ts";
import { type Emblems, folderEmblems } from "./icons.ts";
import type { Location } from "./location.ts";
import type { Volume } from "./mounts.ts";
import { DEFAULT_PREFS } from "./prefs.ts";
import type { Layout, Step } from "./selection.ts";
import { StoreHistory } from "./store-history.ts";
import { StoreLoader } from "./store-loader.ts";
import { StoreOpening } from "./store-opening.ts";
import { StoreRename } from "./store-rename.ts";
import { StoreSearch } from "./store-search.ts";
import { StoreSelection } from "./store-selection.ts";
import { type FilesState, initialState, NOTICE_FADE_MS, type SearchScope, type StoreHost, type StoreOptions, type ViewMode } from "./store-state.ts";
import { StoreView } from "./store-view.ts";

// The state and the names the window, the choosers and the operations use, from store-state.ts.
export type { FilesState, Notice, SearchScope, StoreHost, StoreOptions, ViewMode } from "./store-state.ts";
export { NOTICE_FADE_MS } from "./store-state.ts";

export class FilesStore implements StoreHost {
  private state: FilesState;
  private readonly listeners = new Set<() => void>();
  /** Special folders' emblems on their icons. */
  readonly emblems: Emblems;
  private noticeId = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private volumeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly search = new StoreSearch(this);
  private readonly view: StoreView;
  private readonly opening: StoreOpening;
  private readonly renaming = new StoreRename(this);
  private readonly loader: StoreLoader;
  private readonly history: StoreHistory;
  private readonly selection: StoreSelection;

  constructor(
    readonly env: Env,
    start: Location,
    private readonly options: StoreOptions = {},
  ) {
    const prefs = options.prefs?.read() ?? DEFAULT_PREFS;
    this.emblems = folderEmblems(env.dirs ?? [], env.home);
    this.view = new StoreView(this, options, { search: () => this.search.scheduleSearch(0) });
    this.opening = new StoreOpening(this, options.openFiles);
    this.loader = new StoreLoader(this, options.watch !== false, { search: () => this.state.query !== "" && this.search.scheduleSearch(0) });
    this.history = new StoreHistory(this, {
      leaveSearch: () => this.search.clearSearch(),
      startAt: (path) => this.selection.startAt(path),
      load: (select) => this.loader.load(select),
    });
    this.selection = new StoreSelection(this, { activate: (item) => this.activate(item), commitRename: () => this.commitRename() });
    this.state = initialState(start, prefs);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FilesState => this.state;

  patch(patch: Partial<FilesState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Starts listing, watching, and watching the volumes. */
  start(): void {
    void this.loader.load();
    void this.refreshVolumes();
    this.volumeTimer = setInterval(() => void this.refreshVolumes(), 4000);
  }

  stop(): void {
    this.loader.stop();
    this.search.stop();
    if (this.volumeTimer) clearInterval(this.volumeTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  // --- What the list shows (store-view.ts) -------------------------------------------

  visible(): FileItem[] {
    return this.view.visible();
  }

  keptOut(): string | null {
    return this.view.keptOut();
  }

  refilter(): void {
    this.view.refilter();
  }

  get stale(): boolean {
    return this.view.stale;
  }

  effectiveSort(): SortState | null {
    return this.view.effectiveSort();
  }

  setView(view: ViewMode): void {
    this.view.setView(view);
  }

  setSort(sort: SortState): void {
    this.view.setSort(sort);
  }

  reverseSort(): void {
    this.view.reverseSort();
  }

  toggleHidden(): void {
    this.view.toggleHidden();
  }

  // --- Where it is looking (store-history.ts) ------------------------------------------

  /** Move to `location`, remembering where we were. */
  go(location: Location, options: { record?: boolean; select?: string } = {}): void {
    this.history.go(location, options);
  }

  goBack(): void {
    this.history.goBack();
  }

  goForward(): void {
    this.history.goForward();
  }

  goUp(): void {
    this.history.goUp();
  }

  reload(): void {
    void this.loader.load();
  }

  async refreshVolumes(): Promise<void> {
    const volumes = await loadVolumes(this.env.user, this.env.run);
    if (JSON.stringify(volumes) !== JSON.stringify(this.state.volumes)) this.patch({ volumes });
  }

  // --- Selection (store-selection.ts) ------------------------------------------------

  select(paths: readonly string[]): void {
    this.selection.select(paths);
  }

  selectAll(): void {
    this.selection.selectAll();
  }

  selectedItems(): FileItem[] {
    return this.selection.selectedItems();
  }

  /**
   * A click on an item, with the keys held (selection.ts): select it, ⇧ a
   * run to it, ❖ add or take it out; a plain second click on it opens it.
   */
  click(item: FileItem, held?: Modifiers): void {
    this.selection.click(item, held);
  }

  clickEmpty(): void {
    this.selection.clickEmpty();
  }

  contextOn(item: FileItem): void {
    this.selection.contextOn(item);
  }

  setLayout(layout: Layout): void {
    this.selection.setLayout(layout);
  }

  /** A move key (selection.ts `navigate`): the arrows, Home, End, the page keys; with `extend` (⇧) the run from the anchor. */
  move(step: Step, extend = false): void {
    this.selection.move(step, extend);
  }

  typeAhead(text: string): void {
    this.selection.typeAhead(text);
  }

  // --- Renaming in place (store-rename.ts) ---------------------------------------------

  /**
   * What renames for this browser (Files' operations, a chooser's own): an
   * error to show, or null once it is done. Without one nothing is renamed
   * in place.
   */
  get renamer(): ((path: string, name: string) => Promise<string | null>) | null {
    return this.renaming.renamer;
  }

  set renamer(renamer: ((path: string, name: string) => Promise<string | null>) | null) {
    this.renaming.renamer = renamer;
  }

  /** F2, Rename…, or a new folder: the item's name becomes a field. */
  startRename(path: string): void {
    this.renaming.startRename(path);
  }

  draftRename(text: string): void {
    this.renaming.draftRename(text);
  }

  endRename(): void {
    this.renaming.endRename();
  }

  /** Return, or a click elsewhere: rename to `name` (else the draft); a problem keeps the field, said in the footer. True when it is done. */
  commitRename(name?: string | null): Promise<boolean> {
    return this.renaming.commitRename(name);
  }

  // --- Opening (store-opening.ts) -----------------------------------------------------

  activate(item: FileItem): void {
    this.opening.activate(item);
  }

  openSelection(): void {
    this.opening.openSelection();
  }

  goToPath(text: string): string | null {
    return this.opening.goToPath(text);
  }

  sayPathProblem(text: string): void {
    this.opening.sayPathProblem(text);
  }

  reveal(item: FileItem): void {
    this.opening.reveal(item);
  }

  // --- Search (store-search.ts) -------------------------------------------------------

  setQuery(query: string): void {
    this.search.setQuery(query);
  }

  setScope(scope: SearchScope): void {
    this.search.setScope(scope);
  }

  // --- Messages ----------------------------------------------------------------------

  /**
   * A line in the footer: errors stay until dismissed, other notes fade
   * after `NOTICE_FADE_MS`. One with Undo for `undoStep` stays while that is
   * what Undo takes back (operations.ts takes it down after): a notice that
   * faded as its Undo was clicked let the click fall through to the files.
   */
  say(text: string, error = false, undoStep: number | null = null): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    const id = ++this.noticeId;
    this.patch({ notice: { id, text, error, ...(undoStep === null ? {} : { undoStep }) } });
    if (!error && undoStep === null) {
      this.noticeTimer = setTimeout(() => this.state.notice?.id === id && this.patch({ notice: null }), this.options.noticeFadeMs ?? NOTICE_FADE_MS);
    }
  }

  dismissNotice(): void {
    this.patch({ notice: null });
  }

  volumeByPath(path: string): Volume | undefined {
    return this.state.volumes.find((volume) => volume.mountPoint === path);
  }
}
