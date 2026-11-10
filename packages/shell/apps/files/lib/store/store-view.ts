/**
 * What the listing shows and how: the items as the list has them (search
 * results or the folder, hidden ones only with the toggle, what a chooser's
 * filter lets through, sorted), and the view, sort and Show Hidden choices,
 * which are kept (prefs.ts).
 */

import type { SortState } from "@dashi/ui";
import type { FileItem } from "../../../../src/shared/files/items.ts";
import { sameLocation } from "../location.ts";
import { columnMode, DEFAULT_SORT, fileColumns, sortItems } from "../sort.ts";
import type { FilesState, StoreHost, StoreOptions, ViewMode } from "./store-state.ts";

export class StoreView {
  private shown: { state: FilesState; items: FileItem[] } | null = null;
  private readonly shows: StoreOptions["shows"];
  private readonly keptOutTitle: StoreOptions["keptOutTitle"];
  private readonly prefs: StoreOptions["prefs"];

  constructor(
    private readonly host: StoreHost,
    options: StoreOptions,
    private readonly hooks: {
      /** Show Hidden changed while a search was standing: look again. */
      search: () => void;
    },
  ) {
    this.shows = options.shows;
    this.keptOutTitle = options.keptOutTitle;
    this.prefs = options.prefs;
  }

  /**
   * Items for the current location as the list shows them: search results
   * when searching, else the folder; hidden ones only with the toggle; what
   * a chooser's filter lets through; sorted. Worked out once per state.
   */
  visible(): FileItem[] {
    if (this.shown?.state === this.host.getSnapshot()) return this.shown.items;
    const { found, items, showHidden } = this.host.getSnapshot();
    const source = found ?? items;
    const { shows } = this;
    const kept = source.filter((item) => (showHidden || !item.hidden) && (!shows || shows(item)));
    const sorted = sortItems(kept, fileColumns(columnMode(this.host.getSnapshot())), this.effectiveSort());
    this.shown = { state: this.host.getSnapshot(), items: sorted };
    return sorted;
  }

  /** What the empty listing says when `shows` keeps every item here out (not hidden ones); null when the folder is empty. */
  keptOut(): string | null {
    const { shows, keptOutTitle } = this;
    if (!shows || !keptOutTitle) return null;
    const { found, items, showHidden } = this.host.getSnapshot();
    return (found ?? items).some((item) => (showHidden || !item.hidden) && !shows(item)) ? keptOutTitle : null;
  }

  /** What `shows` lets through changed (a chooser's filter): look again, and drop what no longer shows from the selection. */
  refilter(): void {
    this.shown = null;
    this.host.patch({});
    const shown = new Set(this.visible().map((item) => item.path));
    if (this.host.getSnapshot().selection.some((path) => !shown.has(path)))
      this.host.select(this.host.getSnapshot().selection.filter((path) => shown.has(path)));
  }

  /** The listing shown is the last place's, kept up while this one loads. */
  get stale(): boolean {
    const { loading, listed, location } = this.host.getSnapshot();
    return loading && !sameLocation(listed, location);
  }

  /** The sort in force: null in Recents and the Trash until the person picks one (their order is by time). */
  effectiveSort(): SortState | null {
    const { location, found, sort } = this.host.getSnapshot();
    return found === null && location.kind !== "folder" && sort === DEFAULT_SORT ? null : sort;
  }

  setView(view: ViewMode): void {
    this.host.patch({ view });
    this.keepPrefs();
  }

  setSort(sort: SortState): void {
    this.host.patch({ sort });
    this.keepPrefs();
  }

  /** View › Reverse Order: the same sort the other way. */
  reverseSort(): void {
    const { key, ascending } = this.effectiveSort() ?? DEFAULT_SORT;
    this.setSort({ key, ascending: !ascending });
  }

  toggleHidden(): void {
    this.host.patch({ showHidden: !this.host.getSnapshot().showHidden });
    this.keepPrefs();
    if (this.host.getSnapshot().query !== "") this.hooks.search();
  }

  private keepPrefs(): void {
    const { view, sort, showHidden } = this.host.getSnapshot();
    this.prefs?.write({ view, sort, showHidden });
  }
}
