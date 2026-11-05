/**
 * The file chooser's state: where it stands (Recents, a search, a folder),
 * the rows there that pass the filter, what is picked, the save name, the
 * filter and the choices. It opens on Recents, the files lately used that
 * the app takes, with the search field ready; typing searches the way the
 * launcher does (LocalSearch, src/file-search.ts) and the folder last shown;
 * the sidebar goes to folders; Back returns to the place before, Up to the
 * folder this one is in. Loads run one at a time by generation, so a
 * slow folder can't overwrite the one the person went to after it.
 */

import { basename, dirname } from "node:path";
import { useSyncExternalStore } from "react";
import type { Picked } from "./accept.ts";
import { passes } from "./filters.ts";
import type { ChooserRequest, Filter } from "./options.ts";

export interface Row {
  path: string;
  name: string;
  folder: boolean;
  mime: string;
  mtime: number;
  /** The folder it is in, shown for Recents and search ("~/Documents"). */
  where?: string;
  hidden: boolean;
}

export type Place = { kind: "recents" } | { kind: "search"; query: string } | { kind: "folder"; path: string };

export interface Sources {
  /** Recently used files, newest first, as rows (those still there). */
  recents(): Promise<Row[]>;
  /** Files named like `query`, newest first. */
  search(query: string): Promise<Row[]>;
  folder(path: string): Promise<{ rows: Row[]; error: string | null }>;
  home: string;
}

export interface ChooserState {
  place: Place;
  /** The last folder shown: where a search also looks, and where a save from Recents goes. */
  lastFolder: string | null;
  rows: Row[];
  loading: boolean;
  error: string | null;
  selected: string[];
  filter: Filter | null;
  name: string;
  choices: Record<string, string>;
  /** A file the save would replace, waiting for the person to say so. */
  replace: string | null;
  problem: string | null;
  /** What is typed in the search field. */
  query: string;
  /** Where Back goes, the last place on top (searches aren't kept: Back leaves one). */
  history: Place[];
}

/** The rows that show: folders always (but in folder mode only folders), files the filter lets through, no hidden ones; folders first, then newest first in Recents and search, by name in a folder. */
export function visibleRows(rows: readonly Row[], request: Pick<ChooserRequest, "directory">, filter: Filter | null, place: Place["kind"]): Row[] {
  const shown = rows.filter((row) => !row.hidden && (row.folder || (!request.directory && passes(filter, row.name, row.mime))));
  const byName = (a: Row, b: Row) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  return shown.sort((a, b) => {
    if (place === "folder") return a.folder !== b.folder ? (a.folder ? -1 : 1) : byName(a, b);
    return b.mtime - a.mtime || byName(a, b);
  });
}

/** In folder mode Recents is the folders the recent files are in, each once. */
export function recentFolders(rows: readonly Row[], home: string): Row[] {
  const seen = new Map<string, Row>();
  for (const row of rows) {
    const path = row.folder ? row.path : dirname(row.path);
    if (path === home || seen.has(path)) continue;
    seen.set(path, { path, name: basename(path), folder: true, mime: "inode/directory", mtime: row.mtime, where: tilde(dirname(path), home), hidden: false });
  }
  return [...seen.values()];
}

export const tilde = (path: string, home: string): string => (path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

/** A folder's name as the chooser shows it: Home for the home folder, Computer for the root. */
export const folderName = (path: string, home: string): string => (path === home ? "Home" : path === "/" ? "Computer" : basename(path) || path);

/** The folder pop-up's rows: `path` itself, then each folder it is in, up to the root. */
export function folderTrail(path: string, home: string): Array<{ name: string; path: string }> {
  const trail: Array<{ name: string; path: string }> = [];
  let at = path;
  for (let guard = 0; guard < 64; guard++) {
    trail.push({ name: folderName(at, home), path: at });
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return trail;
}

/** The folder above `path`, or null at the root. */
export const parentOf = (path: string): string | null => (dirname(path) === path ? null : dirname(path));

const samePlace = (a: Place, b: Place): boolean =>
  a.kind === b.kind &&
  (a.kind !== "folder" || (b.kind === "folder" && a.path === b.path)) &&
  (a.kind !== "search" || (b.kind === "search" && a.query === b.query));

/** The most places Back remembers. */
const HISTORY = 50;

export class ChooserModel {
  private state: ChooserState;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly request: ChooserRequest,
    private readonly sources: Sources,
    start: { folder: string; name: string },
  ) {
    const choices = Object.fromEntries(request.choices.map((choice) => [choice.id, choice.initial]));
    // Open starts on Recents; a save starts in its folder, where it will land.
    const place: Place = request.mode === "open" ? { kind: "recents" } : { kind: "folder", path: start.folder };
    this.state = {
      place,
      lastFolder: start.folder,
      rows: [],
      loading: true,
      error: null,
      selected: [],
      filter: request.currentFilter,
      name: start.name,
      choices,
      replace: null,
      problem: null,
      query: "",
      history: [],
    };
    void this.load(place);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChooserState => this.state;

  /** The home folder, which the chooser calls Home. */
  get home(): string {
    return this.sources.home;
  }

  private set(patch: Partial<ChooserState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The rows that show now. */
  visible(): Row[] {
    return visibleRows(this.state.rows, this.request, this.state.filter, this.state.place.kind);
  }

  picked(): Picked[] {
    const rows = new Map(this.state.rows.map((row) => [row.path, row]));
    return this.state.selected.flatMap((path) => {
      const row = rows.get(path);
      return row ? [{ path, folder: row.folder }] : [];
    });
  }

  /** Goes to `place`; Back returns to where it was. */
  go(place: Place): void {
    if (samePlace(place, this.state.place)) return void this.load(place);
    this.remember();
    // Going to where Back would go is going back: the place isn't kept twice.
    const top = this.state.history.at(-1);
    if (top && samePlace(top, place)) this.set({ history: this.state.history.slice(0, -1) });
    void this.load(place);
  }

  /** Back: the place before this one, if there is one. */
  back(): void {
    const previous = this.state.history.at(-1);
    if (!previous) return;
    this.set({ history: this.state.history.slice(0, -1), query: "" });
    void this.load(previous);
  }

  /** Up: the folder this folder is in. */
  up(): void {
    const parent = this.state.place.kind === "folder" ? parentOf(this.state.place.path) : null;
    if (parent !== null) this.go({ kind: "folder", path: parent });
  }

  canGoBack(): boolean {
    return this.state.history.length > 0;
  }

  canGoUp(): boolean {
    return this.state.place.kind === "folder" && parentOf(this.state.place.path) !== null;
  }

  /** Keeps the place showing for Back, unless it is a search or is on top already. */
  private remember(): void {
    const { place, history } = this.state;
    if (place.kind === "search") return;
    const top = history.at(-1);
    if (top && samePlace(top, place)) return;
    this.set({ history: [...history, place].slice(-HISTORY) });
  }

  /** Typing in the search field: a search from two characters, back to where it was when emptied. */
  search(query: string): void {
    this.set({ query });
    const text = query.trim();
    if (text.length >= 2) {
      // Back from a search's results (or from a folder opened there) returns to where the search began.
      this.remember();
      return void this.load({ kind: "search", query: text });
    }
    if (this.state.place.kind !== "search") return;
    const back = this.state.lastFolder && this.request.mode !== "open";
    this.go(back && this.state.lastFolder ? { kind: "folder", path: this.state.lastFolder } : { kind: "recents" });
  }

  /** A click: picks the row (with `extend`, adds it, where several may be picked); a save takes a file's name. */
  pick(path: string, extend = false): void {
    const row = this.state.rows.find((each) => each.path === path);
    if (!row) return;
    const several = extend && this.request.multiple;
    const selected = several ? (this.state.selected.includes(path) ? this.state.selected.filter((p) => p !== path) : [...this.state.selected, path]) : [path];
    const name = this.request.mode === "save" && !row.folder ? row.name : this.state.name;
    this.set({ selected, name, replace: null, problem: null });
  }

  /** Arrow keys: the next or previous row picked. */
  step(by: 1 | -1): void {
    const rows = this.visible();
    if (rows.length === 0) return;
    const at = rows.findIndex((row) => row.path === this.state.selected.at(-1));
    const next = rows[Math.min(rows.length - 1, Math.max(0, at < 0 ? (by > 0 ? 0 : rows.length - 1) : at + by))];
    if (next) this.pick(next.path);
  }

  setFilter(filter: Filter | null): void {
    this.set({ filter, selected: [] });
  }

  setName(name: string): void {
    this.set({ name, replace: null, problem: null });
  }

  setChoice(id: string, value: string): void {
    this.set({ choices: { ...this.state.choices, [id]: value } });
  }

  ask(patch: Pick<Partial<ChooserState>, "replace" | "problem">): void {
    this.set({ replace: null, problem: null, ...patch });
  }

  private async load(place: Place): Promise<void> {
    const generation = ++this.generation;
    const lastFolder = place.kind === "folder" ? place.path : this.state.lastFolder;
    this.set({ place, lastFolder, loading: true, error: null, selected: [], replace: null, problem: null });
    let rows: Row[] = [];
    let error: string | null = null;
    try {
      if (place.kind === "folder") ({ rows, error } = await this.sources.folder(place.path));
      else if (place.kind === "recents") {
        rows = await this.sources.recents();
        if (this.request.directory) rows = recentFolders(rows, this.sources.home);
      } else rows = await this.searchRows(place.query, lastFolder);
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    if (generation !== this.generation) return;
    this.set({ rows, loading: false, error });
  }

  /** LocalSearch's hits, then the last folder's own names that match (so search works without an index). */
  private async searchRows(query: string, folder: string | null): Promise<Row[]> {
    const lower = query.toLowerCase();
    const [hits, here] = await Promise.all([
      this.sources.search(query).catch(() => []),
      folder ? this.sources.folder(folder).then((listing) => listing.rows.filter((row) => row.name.toLowerCase().includes(lower))) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    return [...hits, ...here.map((row) => ({ ...row, where: tilde(dirname(row.path), this.sources.home) }))].filter((row) => {
      if (seen.has(row.path)) return false;
      seen.add(row.path);
      return true;
    });
  }
}

export function useChooser(model: ChooserModel): ChooserState {
  return useSyncExternalStore(model.subscribe, model.getSnapshot);
}
