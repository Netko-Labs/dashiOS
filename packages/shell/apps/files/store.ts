/**
 * The state of one Files window and what moves it: where it is looking
 * (with back and forward), what is listed and how it is sorted, the
 * selection, search, and the volumes in the sidebar. It is a plain store
 * (`subscribe`/`getSnapshot`) the React views read with
 * `useSyncExternalStore`. Operations that write (copy, trash, rename…) are
 * in operations.ts and report through here.
 */

import { type FSWatcher, statSync, watch } from "node:fs";
import { type SortState } from "@dashi/ui";
import type { Env } from "./env.ts";
import { loadVolumes, space } from "./drives.ts";
import { describeError, type FileItem, readFolder } from "./items.ts";
import { folderAt, type Location, sameLocation } from "./location.ts";
import type { Volume } from "./mounts.ts";
import { mayOpen, openWithDefault } from "./open.ts";
import { expandHome, normalizePath, parentOf, tilde } from "./paths.ts";
import { parseFileUri } from "./uri.ts";
import { itemAt } from "./items.ts";
import { searchComputer, searchFolder } from "./search.ts";
import { columnMode, DEFAULT_SORT, fileColumns, findByPrefix, sortItems } from "./sort.ts";
import { listTrash } from "./trashops.ts";

export type ViewMode = "icons" | "list";
export type SearchScope = "folder" | "computer";

export interface Notice {
  id: number;
  text: string;
  error: boolean;
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
  /** Clicks add to the selection instead of replacing it. */
  multi: boolean;
  clipboard: { paths: readonly string[]; cut: boolean } | null;
  volumes: readonly Volume[];
  free: { free: number; total: number } | null;
  notice: Notice | null;
}

const DOUBLE_CLICK_MS = 450;
const SEARCH_DELAY_MS = 180;

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
  private typed: { text: string; time: number } = { text: "", time: 0 };
  private noticeId = 0;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private volumeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly env: Env,
    start: Location,
    private readonly options: { watch?: boolean } = {},
  ) {
    this.state = {
      location: start,
      canBack: false,
      canForward: false,
      items: [],
      loading: true,
      error: null,
      showHidden: false,
      view: "icons",
      sort: DEFAULT_SORT,
      query: "",
      scope: "folder",
      found: null,
      searching: false,
      truncated: false,
      selection: [],
      multi: false,
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

  /** Items for the current location as the list shows them: search results when searching, else the folder; hidden ones only with the toggle; sorted. */
  visible(): FileItem[] {
    const { found, items, showHidden } = this.state;
    const source = found ?? items;
    const shown = showHidden ? source : source.filter((item) => !item.hidden);
    return sortItems(shown, fileColumns(columnMode(this.state)), this.effectiveSort());
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
    this.patch({
      location,
      canBack: this.back.length > 0,
      canForward: this.forward.length > 0,
      selection: options.select ? [options.select] : [],
      items: [],
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
      loading: false,
      error,
      selection: select && keep.has(select) ? [select] : this.state.selection.filter((path) => keep.has(path)),
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
  }

  setSort(sort: SortState): void {
    this.patch({ sort });
  }

  toggleHidden(): void {
    this.patch({ showHidden: !this.state.showHidden });
    if (this.state.query !== "") this.scheduleSearch(0);
  }

  // --- Selection ---------------------------------------------------------------------

  select(paths: readonly string[]): void {
    this.patch({ selection: paths });
  }

  selectAll(): void {
    this.patch({ selection: this.visible().map((item) => item.path) });
  }

  toggleMulti(): void {
    this.patch({ multi: !this.state.multi });
  }

  selectedItems(): FileItem[] {
    const chosen = new Set(this.state.selection);
    return this.visible().filter((item) => chosen.has(item.path));
  }

  /** A click on an item: select it (add it, in multi mode), or open it when it is the second click on it. */
  click(item: FileItem): void {
    const now = this.env.now();
    const again = this.lastClick?.path === item.path && now - this.lastClick.time <= DOUBLE_CLICK_MS;
    this.lastClick = { path: item.path, time: now };
    if (again && !this.state.multi) {
      this.lastClick = null;
      this.activate(item);
      return;
    }
    const { selection, multi } = this.state;
    if (multi) this.select(selection.includes(item.path) ? selection.filter((path) => path !== item.path) : [...selection, item.path]);
    else this.select([item.path]);
  }

  /** A right-click: a click outside the selection selects what was clicked. */
  contextOn(item: FileItem): void {
    if (!this.state.selection.includes(item.path)) this.select([item.path]);
  }

  /** The arrow keys: the next or previous item, `step` places away (a row of icons is `columns`). */
  move(step: number): void {
    const list = this.visible();
    if (list.length === 0) return;
    const last = this.state.selection.at(-1);
    const at = last === undefined ? -1 : list.findIndex((item) => item.path === last);
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + step));
    const target = list[next];
    if (target) this.select([target.path]);
  }

  /** Characters typed with the window focused select the next item that starts with them. */
  typeAhead(text: string): void {
    const now = this.env.now();
    this.typed = { text: now - this.typed.time > 900 ? text : this.typed.text + text, time: now };
    const found = findByPrefix(this.visible(), this.typed.text, this.state.selection.at(-1) ?? null);
    if (found) this.select([found.path]);
  }

  // --- Opening -----------------------------------------------------------------------

  /** Open a folder here, or a file in its default app. */
  activate(item: FileItem): void {
    if (item.kind === "folder") {
      this.go(folderAt(item.path));
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
    for (const item of this.selectedItems().slice(0, 8)) this.activate(item);
  }

  /** Go to a typed path (`~/x`, an absolute path, a file:// URI); an error to show, or null. A path to a file shows its folder with the file selected. */
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
    return null;
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

  /** A line in the footer: errors stay until dismissed, other notes fade. */
  say(text: string, error = false): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    const id = ++this.noticeId;
    this.patch({ notice: { id, text, error } });
    if (!error) this.noticeTimer = setTimeout(() => this.state.notice?.id === id && this.patch({ notice: null }), 5000);
  }

  dismissNotice(): void {
    this.patch({ notice: null });
  }

  volumeByPath(path: string): Volume | undefined {
    return this.state.volumes.find((volume) => volume.mountPoint === path);
  }
}
