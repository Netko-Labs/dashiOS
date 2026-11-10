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

import { type FSWatcher, statSync, watch } from "node:fs";
import type { SortState } from "@dashi/ui";
import type { Modifiers } from "@mirinjs/metal";
import { describeError, type FileItem, itemAt, readFolder } from "../../src/shared/files/items.ts";
import { mayOpen, openWithDefault } from "../../src/shared/files/open.ts";
import { expandHome, normalizePath, parentOf, tilde } from "../../src/shared/files/paths.ts";
import { searchComputer, searchFolder } from "../../src/shared/files/search.ts";
import { listTrash } from "../../src/shared/files/trashops.ts";
import { parseFileUri } from "../../src/shared/files/uri.ts";
import { loadVolumes, space } from "./drives.ts";
import type { Env } from "./env.ts";
import { type Emblems, folderEmblems } from "./icons.ts";
import { folderAt, type Location, sameLocation } from "./location.ts";
import type { Volume } from "./mounts.ts";
import { DEFAULT_PREFS, type FilesPrefs } from "./prefs.ts";
import { isPlain, type Layout, navigate, pick, type Step } from "./selection.ts";
import { columnMode, DEFAULT_SORT, fileColumns, findByPrefix, sortItems } from "./sort.ts";

export type ViewMode = "icons" | "list";
export type SearchScope = "folder" | "computer";

export interface Notice {
  id: number;
  text: string;
  error: boolean;
  /**
   * It reports a write Edit › Undo can take back: that step (the undo
   * stack's `undoStep`). The notice offers Undo, and stays, only while Undo
   * still takes back that step (operations.ts).
   */
  undoStep?: number;
}

export interface FilesState {
  location: Location;
  canBack: boolean;
  canForward: boolean;
  items: readonly FileItem[];
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  view: ViewMode;
  sort: SortState;
  query: string;
  scope: SearchScope;
  /** Search results; null when not searching. */
  found: readonly FileItem[] | null;
  searching: boolean;
  truncated: boolean;
  selection: readonly string[];
  /** The item being renamed in place (F2, a new folder), or null. */
  renaming: string | null;
  /** Where `items` were listed: while a new place loads, the last one's items stay up (`stale`). */
  listed: Location;
  clipboard: { paths: readonly string[]; cut: boolean } | null;
  volumes: readonly Volume[];
  free: { free: number; total: number } | null;
  notice: Notice | null;
}

const DOUBLE_CLICK_MS = 450;
const NO_KEYS: Modifiers = { shift: false, control: false, alt: false, super: false };
const SEARCH_DELAY_MS = 180;

export interface StoreOptions {
  watch?: boolean;
  noticeFadeMs?: number;
  /** What may show (a chooser's filter); everything by default. Hidden files follow Show Hidden either way. */
  shows?: (item: FileItem) => boolean;
  /** What an empty listing says when the folder has items `shows` keeps out ("No folders here"); by default it is empty. */
  keptOutTitle?: string;
  /** Opening files means this here (a chooser's Open); by default each opens in its app. */
  openFiles?: (items: FileItem[]) => void;
  /** The view, sort and Show Hidden to start with, and where a change to them goes (prefs.ts); none: the defaults, kept nowhere. */
  prefs?: { read(): FilesPrefs; write(prefs: FilesPrefs): void };
}
/** How long a notice that only informs stays. */
export const NOTICE_FADE_MS = 5000;

export class FilesStore {
  private state: FilesState;
  private readonly listeners = new Set<() => void>();
  private back: Location[] = [];
  private forward: Location[] = [];
  private loadToken = 0;
  private listing: AbortController | null = null;
  private searchToken = 0;
  private searchRun: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private watcher: FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastClick: { path: string; time: number } | null = null;
  /** Where a ⇧-click's run starts: the last item clicked without ⇧. */
  private anchor: string | null = null;
  /** Where the keyboard is: the moving end of a ⇧-arrow run. */
  private focus: string | null = null;
  private layout: Layout = { columns: 1, page: 10 };
  private shown: { state: FilesState; items: FileItem[] } | null = null;
  /** Special folders' emblems on their icons. */
  readonly emblems: Emblems;
  private typed: { text: string; time: number } = { text: "", time: 0 };
  private noticeId = 0;
  /** The notice a typed path that led nowhere put up (`sayPathProblem`). */
  private pathProblem: number | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private volumeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly env: Env,
    start: Location,
    private readonly options: StoreOptions = {},
  ) {
    const prefs = options.prefs?.read() ?? DEFAULT_PREFS;
    this.emblems = folderEmblems(env.dirs ?? [], env.home);
    this.state = {
      location: start,
      canBack: false,
      canForward: false,
      items: [],
      loading: true,
      error: null,
      showHidden: prefs.showHidden,
      view: prefs.view,
      // The default sort object itself, so Recents and the Trash keep their own order until one is picked.
      sort: prefs.sort.key === DEFAULT_SORT.key && prefs.sort.ascending === DEFAULT_SORT.ascending ? DEFAULT_SORT : prefs.sort,
      query: "",
      scope: "folder",
      found: null,
      searching: false,
      truncated: false,
      selection: [],
      renaming: null,
      listed: start,
      clipboard: null,
      volumes: [],
      free: null,
      notice: null,
    };
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
    void this.load();
    void this.refreshVolumes();
    this.volumeTimer = setInterval(() => void this.refreshVolumes(), 4000);
  }

  stop(): void {
    this.listing?.abort();
    this.searchRun?.abort();
    this.watcher?.close();
    if (this.volumeTimer) clearInterval(this.volumeTimer);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
  }

  // --- Looking at things -------------------------------------------------------------

  /**
   * Items for the current location as the list shows them: search results
   * when searching, else the folder; hidden ones only with the toggle; what
   * a chooser's filter lets through; sorted. Worked out once per state.
   */
  visible(): FileItem[] {
    if (this.shown?.state === this.state) return this.shown.items;
    const { found, items, showHidden } = this.state;
    const source = found ?? items;
    const { shows } = this.options;
    const kept = source.filter((item) => (showHidden || !item.hidden) && (!shows || shows(item)));
    const sorted = sortItems(kept, fileColumns(columnMode(this.state)), this.effectiveSort());
    this.shown = { state: this.state, items: sorted };
    return sorted;
  }

  /** What the empty listing says when `shows` keeps every item here out (not hidden ones); null when the folder is empty. */
  keptOut(): string | null {
    const { shows, keptOutTitle } = this.options;
    if (!shows || !keptOutTitle) return null;
    const { found, items, showHidden } = this.state;
    return (found ?? items).some((item) => (showHidden || !item.hidden) && !shows(item)) ? keptOutTitle : null;
  }

  /** What `shows` lets through changed (a chooser's filter): look again, and drop what no longer shows from the selection. */
  refilter(): void {
    this.shown = null;
    this.patch({});
    const shown = new Set(this.visible().map((item) => item.path));
    if (this.state.selection.some((path) => !shown.has(path))) this.select(this.state.selection.filter((path) => shown.has(path)));
  }

  /** The listing shown is the last place's, kept up while this one loads. */
  get stale(): boolean {
    const { loading, listed, location } = this.state;
    return loading && !sameLocation(listed, location);
  }

  /** The sort in force: null in Recents and the Trash until the person picks one (their order is by time). */
  effectiveSort(): SortState | null {
    const { location, found, sort } = this.state;
    return found === null && location.kind !== "folder" && sort === DEFAULT_SORT ? null : sort;
  }

  /** Move to `location`, remembering where we were. */
  go(location: Location, options: { record?: boolean; select?: string } = {}): void {
    if (options.record !== false && sameLocation(location, this.state.location)) {
      // Already here: a search is left, and a revealed item is selected.
      this.clearSearch();
      if (options.select) this.select([options.select]);
      return;
    }
    if (options.record !== false) {
      this.back.push(this.state.location);
      this.forward = [];
    }
    this.clearSearch();
    this.anchor = options.select ?? null;
    this.focus = options.select ?? null;
    // The last place's items stay up until this one's land (`stale`): a quick folder doesn't flicker.
    this.patch({
      location,
      canBack: this.back.length > 0,
      canForward: this.forward.length > 0,
      selection: options.select ? [options.select] : [],
      renaming: null,
      error: null,
      loading: true,
    });
    void this.load(options.select);
  }

  goBack(): void {
    const previous = this.back.pop();
    if (!previous) return;
    this.forward.push(this.state.location);
    this.go(previous, { record: false });
    this.patch({ canBack: this.back.length > 0, canForward: true });
  }

  goForward(): void {
    const next = this.forward.pop();
    if (!next) return;
    this.back.push(this.state.location);
    this.go(next, { record: false });
    this.patch({ canBack: true, canForward: this.forward.length > 0 });
  }

  goUp(): void {
    const { location } = this.state;
    if (location.kind === "folder" && location.path !== "/") {
      const trashed = location.path.startsWith(`${this.env.trash.files}/`) && parentOf(location.path) === this.env.trash.files;
      this.go(trashed ? { kind: "trash" } : folderAt(parentOf(location.path)), { select: location.path });
    } else if (location.kind !== "folder") {
      this.go(folderAt(this.env.home));
    }
  }

  reload(): void {
    void this.load();
  }

  private async load(select?: string): Promise<void> {
    const token = ++this.loadToken;
    this.listing?.abort();
    const controller = (this.listing = new AbortController());
    this.watcher?.close();
    this.watcher = null;
    const { location } = this.state;
    let items: FileItem[] = [];
    let error: string | null = null;
    if (location.kind === "folder") {
      const result = await readFolder(location.path, this.env.mime, controller.signal);
      items = result.items;
      error = result.error;
    } else if (location.kind === "trash") {
      items = (await listTrash(this.env.trash, this.env.mime)).map((item) =>
        item.original ? { ...item, where: tilde(parentOf(item.original), this.env.home) } : item,
      );
    } else {
      items = await this.recentItems();
    }
    if (token !== this.loadToken) return;
    const keep = new Set(items.map((item) => item.path));
    this.patch({
      items,
      listed: location,
      loading: false,
      error,
      selection: select && keep.has(select) ? [select] : this.state.selection.filter((path) => keep.has(path)),
      renaming: this.state.renaming !== null && keep.has(this.state.renaming) ? this.state.renaming : null,
    });
    this.watchLocation(location);
    if (location.kind === "folder") void space(location.path).then((free) => token === this.loadToken && this.patch({ free }));
    else this.patch({ free: null });
    if (this.state.query !== "") this.scheduleSearch(0);
  }

  private async recentItems(): Promise<FileItem[]> {
    const recent = await this.env.recents();
    const items = await Promise.all(recent.slice(0, 200).map((file) => itemAt(file.path, this.env.mime)));
    return items.flatMap((item, index) => {
      const file = recent[index];
      if (!item || item.kind === "other" || !file) return [];
      return [{ ...item, where: tilde(parentOf(item.path), this.env.home), mtime: file.time || item.mtime }];
    });
  }

  private watchLocation(location: Location): void {
    if (this.options.watch === false || location.kind === "recents") return;
    const path = location.kind === "folder" ? location.path : this.env.trash.files;
    try {
      this.watcher = watch(path, { persistent: false }, () => {
        if (this.watchTimer) clearTimeout(this.watchTimer);
        // A burst of changes (a copy, an extraction) is one reload.
        this.watchTimer = setTimeout(() => void this.load(), 250);
      });
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // A folder that can't be watched is reloaded by hand.
    }
  }

  async refreshVolumes(): Promise<void> {
    const volumes = await loadVolumes(this.env.user, this.env.run);
    if (JSON.stringify(volumes) !== JSON.stringify(this.state.volumes)) this.patch({ volumes });
  }

  // --- View options ------------------------------------------------------------------

  setView(view: ViewMode): void {
    this.patch({ view });
    this.keepPrefs();
  }

  setSort(sort: SortState): void {
    this.patch({ sort });
    this.keepPrefs();
  }

  /** View › Reverse Order: the same sort the other way. */
  reverseSort(): void {
    const { key, ascending } = this.effectiveSort() ?? DEFAULT_SORT;
    this.setSort({ key, ascending: !ascending });
  }

  toggleHidden(): void {
    this.patch({ showHidden: !this.state.showHidden });
    this.keepPrefs();
    if (this.state.query !== "") this.scheduleSearch(0);
  }

  private keepPrefs(): void {
    const { view, sort, showHidden } = this.state;
    this.options.prefs?.write({ view, sort, showHidden });
  }

  // --- Selection ---------------------------------------------------------------------

  select(paths: readonly string[]): void {
    this.patch({ selection: paths });
    this.focus = paths.at(-1) ?? null;
    if (paths.length <= 1) this.anchor = paths[0] ?? null;
  }

  selectAll(): void {
    this.patch({ selection: this.visible().map((item) => item.path) });
  }

  selectedItems(): FileItem[] {
    const chosen = new Set(this.state.selection);
    return this.visible().filter((item) => chosen.has(item.path));
  }

  /**
   * A click on an item, with the keys held (selection.ts): select it, ⇧ a
   * run to it, ❖ add or take it out; a plain second click on it opens it.
   */
  click(item: FileItem, held: Modifiers = NO_KEYS): void {
    if (this.state.renaming !== null && this.state.renaming !== item.path) void this.commitRename();
    if (this.state.renaming === item.path) return;
    const now = this.env.now();
    const plain = isPlain(held);
    const again = plain && this.lastClick?.path === item.path && now - this.lastClick.time <= DOUBLE_CLICK_MS;
    this.lastClick = plain ? { path: item.path, time: now } : null;
    if (again) {
      this.lastClick = null;
      this.activate(item);
      return;
    }
    const shown = this.visible().map((each) => each.path);
    const picked = pick(shown, this.state.selection, this.anchor, item.path, held);
    this.patch({ selection: picked.selection });
    this.anchor = picked.anchor;
    this.focus = item.path;
  }

  /** A click on the listing's empty space: nothing is selected. */
  clickEmpty(): void {
    if (this.state.renaming !== null) void this.commitRename();
    this.lastClick = null;
    if (this.state.selection.length > 0) this.select([]);
  }

  /** A right-click: a click outside the selection selects what was clicked. */
  contextOn(item: FileItem): void {
    if (!this.state.selection.includes(item.path)) this.select([item.path]);
  }

  /** How the view lays the items out, for the arrows: icons in rows of `columns`; `page` rows to a screen. */
  setLayout(layout: Layout): void {
    this.layout = layout;
  }

  /** A move key (selection.ts `navigate`): the arrows, Home, End, the page keys; with `extend` (⇧) the run from the anchor. */
  move(step: Step, extend = false): void {
    const columns = this.state.view === "icons" ? this.layout.columns : 1;
    const shown = this.visible().map((item) => item.path);
    const moved = navigate(shown, this.state.selection, this.anchor, this.focus, step, { ...this.layout, columns }, extend);
    if (!moved) return;
    this.patch({ selection: moved.selection });
    this.anchor = moved.anchor;
    this.focus = moved.focus;
  }

  /** Characters typed with the window focused select the next item that starts with them. */
  typeAhead(text: string): void {
    const now = this.env.now();
    this.typed = { text: now - this.typed.time > 900 ? text : this.typed.text + text, time: now };
    const found = findByPrefix(this.visible(), this.typed.text, this.state.selection.at(-1) ?? null);
    if (found) this.select([found.path]);
  }

  // --- Renaming in place -------------------------------------------------------------

  /**
   * What renames for this browser (Files' operations, a chooser's own): an
   * error to show, or null once it is done. Without one nothing is renamed
   * in place.
   */
  renamer: ((path: string, name: string) => Promise<string | null>) | null = null;
  /** The name as typed so far in the field, kept for a click elsewhere, which commits it. */
  private draft: string | null = null;

  /** F2, Rename…, or a new folder: the item's name becomes a field. */
  startRename(path: string): void {
    if (!this.renamer) return;
    this.draft = null;
    this.select([path]);
    this.patch({ renaming: path });
  }

  /** The field's text changed. */
  draftRename(text: string): void {
    this.draft = text;
  }

  /** Esc: the name stays as it was. */
  endRename(): void {
    this.draft = null;
    if (this.state.renaming !== null) this.patch({ renaming: null });
  }

  /** Return, or a click elsewhere: rename to `name` (else the draft); a problem keeps the field, said in the footer. True when it is done. */
  async commitRename(name: string | null = this.draft): Promise<boolean> {
    const path = this.state.renaming;
    if (path === null) return true;
    const wanted = name ?? path.slice(path.lastIndexOf("/") + 1);
    const problem = this.renamer ? await this.renamer(path, wanted) : null;
    if (problem !== null) {
      this.say(problem, true);
      return false;
    }
    if (this.state.renaming === path) this.endRename();
    return true;
  }

  // --- Opening -----------------------------------------------------------------------

  /** Open a folder here, or a file in its default app. */
  activate(item: FileItem): void {
    if (item.kind === "folder") {
      this.go(folderAt(item.path));
      return;
    }
    if (this.options.openFiles) {
      this.options.openFiles([item]);
      return;
    }
    const check = mayOpen(item);
    if (!check.ok) {
      this.say(check.reason ?? "That can’t be opened.", true);
      return;
    }
    void openWithDefault(item.path, this.env.run).then((problem) => problem && this.say(`“${item.name}” couldn’t be opened: ${problem}`, true));
  }

  openSelection(): void {
    const items = this.selectedItems();
    const files = items.filter((item) => item.kind !== "folder");
    // A chooser takes its files at once (that is its answer); a folder is gone into.
    if (this.options.openFiles && files.length > 0) return this.options.openFiles(files);
    for (const item of items.slice(0, 8)) this.activate(item);
  }

  /**
   * Go to a typed path (`~/x`, an absolute path, a file:// URI); an error to show, or null. A path
   * to a file shows its folder with the file selected. A path that works takes down the error a
   * path before it put up (`sayPathProblem`).
   */
  goToPath(text: string): string | null {
    const typed = text.trim();
    if (typed === "") return "Type a folder’s path.";
    const raw = typed.startsWith("file://") ? parseFileUri(typed) : expandHome(typed, this.env.home);
    const path = raw === null ? null : normalizePath(raw);
    if (path === null) return "That isn’t a path to a folder. Start with / or ~.";
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(path);
    } catch (error) {
      return describeError(error, path);
    }
    if (info.isDirectory()) this.go(folderAt(path));
    else this.go(folderAt(parentOf(path)), { select: path });
    if (this.pathProblem !== null && this.state.notice?.id === this.pathProblem) this.dismissNotice();
    this.pathProblem = null;
    return null;
  }

  /** Show what was wrong with a typed path (an error, until a path works or it is dismissed). */
  sayPathProblem(text: string): void {
    this.say(text, true);
    this.pathProblem = this.noticeId;
  }

  /** Show an item's folder with the item selected (from search results and Recents). */
  reveal(item: FileItem): void {
    this.go(folderAt(parentOf(item.path)), { select: item.path });
  }

  // --- Search ------------------------------------------------------------------------

  setQuery(query: string): void {
    this.patch({ query });
    if (query.trim() === "") {
      this.clearSearch();
      return;
    }
    this.scheduleSearch(SEARCH_DELAY_MS);
  }

  setScope(scope: SearchScope): void {
    this.patch({ scope });
    if (this.state.query.trim() !== "") this.scheduleSearch(0);
  }

  private clearSearch(): void {
    this.searchToken++;
    this.searchRun?.abort();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.patch({ found: null, searching: false, truncated: false, query: "" });
  }

  private scheduleSearch(delay: number): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.runSearch(), delay);
  }

  private async runSearch(): Promise<void> {
    const query = this.state.query.trim();
    if (query === "") return;
    const token = ++this.searchToken;
    this.searchRun?.abort();
    const controller = (this.searchRun = new AbortController());
    const { location, scope, showHidden } = this.state;
    this.patch({ searching: true, found: this.state.found ?? [] });
    const apply = (found: FileItem[], truncated: boolean, searching: boolean): void => {
      if (token === this.searchToken) this.patch({ found, truncated, searching });
    };
    if (scope === "computer") {
      const found = await searchComputer(query, this.env.home, this.env.mime, this.env.run);
      apply(found, false, false);
      return;
    }
    if (location.kind !== "folder") {
      // Recents and the Trash are lists already: filter them in place.
      const lower = query.toLowerCase();
      apply(
        this.state.items.filter((item) => item.name.toLowerCase().includes(lower)),
        false,
        false,
      );
      return;
    }
    const result = await searchFolder(location.path, query, {
      hidden: showHidden,
      home: this.env.home,
      index: this.env.mime,
      signal: controller.signal,
      onBatch: (items) => apply(items, false, true),
    });
    apply(result.items, result.truncated, false);
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
