/**
 * Settings' change log: every change to a setting, as an entry that says
 * what changed, from what to what, who changed it (you, or an agent by
 * name: acting.ts) and when. System Settings lists the entries in Recently
 * changed, each with Undo, and ❖Z there undoes the newest (Edit › Undo,
 * through `undo`, the settings store's @dashi/ui stack).
 *
 * The settings store records each change it saves (store.ts `patch`), and
 * the registry records the switches that live outside settings.json
 * (registry/values.ts `flag`). A change only some program makes on its own
 * (how many Spaces there are, the launcher's aliases) has no words
 * (words.ts) and is not an entry. Changing the same setting again soon after
 * (a slider dragged) is the same entry. Undo puts back every value the
 * entry changed, through the `Applier` attached for its keys' prefix
 * (`<section>` of settings.json, `flags`); an entry can be undone while
 * those values are still what it set them to and no newer entry changed
 * them since.
 *
 * The newest entries are kept in `$XDG_STATE_HOME/dashi/settings-changes.json`
 * (written after the change, off the moment it is made), so the list and its
 * Undo outlive a restart; ❖Z covers this session's changes only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { UNDO_JOIN_MS as JOIN_MS, type UndoStack } from "@dashi/ui";
import { type Actor, actor } from "../../../acting.ts";
import { readEntries } from "./file.ts";
import { sameValue } from "./words.ts";

/** One value changed: `undefined` is "not set" (the default). */
export interface Change {
  /** `<section>.<key>` of settings.json, or `flags.<key>`. */
  key: string;
  from: unknown;
  to: unknown;
}

/** How an entry reads. */
export interface ChangeWords {
  /** "Text size", "Dark Mode". */
  name: string;
  /** What Edit › Undo calls it: "Text Size" ("Undo Text Size"). */
  menu: string;
  /** The values as the pane says them: "Default", "Larger", "on". */
  from: string;
  to: string;
  /** The registry row it is (`<pane>/<row>`), to open Settings at. */
  row?: string;
}

export interface ChangeEntry {
  id: number;
  /** When, in ms. */
  at: number;
  /** The agent that changed it; null for you. */
  by: Actor | null;
  changes: readonly Change[];
  words: ChangeWords;
  undone: boolean;
}

/** Reads and writes the values under one prefix, by the rest of the key. */
export interface Applier {
  read(field: string): unknown;
  write(field: string, value: unknown): void;
}

export interface ChangeLogOptions {
  undo: UndoStack;
  /** Words for a change, or null when it isn't a setting people change (not logged). */
  describe(changes: readonly Change[]): ChangeWords | null;
  /** Where entries are kept; null keeps them in memory (tests, and a store with a file of its own). */
  path?: string | null;
  now?: () => number;
}

/** How many entries are kept. */
export const CHANGES_KEPT = 50;
/** How long after a change the file is written. */
const SAVE_MS = 400;

/** "claude" acted, "claude" again; or you twice. */
const sameActor = (a: Actor | null, b: Actor | null): boolean => (a === null || b === null ? a === b : a.agent === b.agent && a.key === b.key);

const prefixOf = (key: string): { prefix: string; field: string } => {
  const dot = key.indexOf(".");
  return { prefix: key.slice(0, dot), field: key.slice(dot + 1) };
};

export class ChangeLog {
  private list: ChangeEntry[];
  private serial: number;
  private readonly appliers = new Map<string, Applier>();
  private readonly listeners = new Set<() => void>();
  /** Undo step ids, by entry id: which step ❖Z would take back for an entry of this session. */
  private readonly steps = new Map<number, number>();
  /** An Undo or Redo is writing values back: what it writes is not a new change. */
  private replaying = false;
  /** Changes recorded inside `group`, made one entry when it ends. */
  private grouped: { words: ChangeWords | null; changes: Change[] } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly undo: UndoStack;
  private readonly describe: ChangeLogOptions["describe"];
  private readonly path: string | null;
  private readonly now: () => number;

  constructor(options: ChangeLogOptions) {
    this.undo = options.undo;
    this.describe = options.describe;
    this.path = options.path ?? null;
    this.now = options.now ?? Date.now;
    this.list = this.path ? readEntries(this.path).slice(0, CHANGES_KEPT) : [];
    this.serial = this.list.reduce((most, entry) => Math.max(most, entry.id), 0);
  }

  /** Where values under `prefix` are read and written back (settings.json's sections; `flags`). */
  attach(prefix: string, applier: Applier): void {
    this.appliers.set(prefix, applier);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The entries, newest first. */
  getSnapshot = (): readonly ChangeEntry[] => this.list;

  /**
   * A change was made (by whoever `actor()` says). Values that didn't move
   * are left out; inside `group` it joins the group's entry; else the same
   * single setting changed again by the same hand within `JOIN_MS` joins
   * the newest entry. `words` names it where `describe` would not.
   */
  record(changes: readonly Change[], words?: ChangeWords): void {
    if (this.replaying) return;
    const moved = changes.filter((change) => !sameValue(change.from, change.to));
    if (moved.length === 0) return;
    if (this.grouped) {
      this.grouped.changes.push(...moved);
      return;
    }
    const by = actor();
    const at = this.now();
    if (this.join(moved, by, at)) return;
    const named = words ?? this.describe(moved);
    if (!named) return;
    const entry: ChangeEntry = { id: ++this.serial, at, by: by ? { ...by } : null, changes: moved, words: named, undone: false };
    this.undo.push({ name: named.menu, undo: () => this.revert(entry), do: () => this.reapply(entry) });
    const step = this.undo.state.undoStep;
    if (step !== null) this.steps.set(entry.id, step);
    this.list = [entry, ...this.list].slice(0, CHANGES_KEPT);
    this.changed();
  }

  /** Runs `work` (synchronously); every change it makes is one entry, named `words` (else by its first named change). */
  group<T>(words: ChangeWords | null, work: () => T): T {
    if (this.grouped || this.replaying) return work();
    const group: { words: ChangeWords | null; changes: Change[] } = { words, changes: [] };
    this.grouped = group;
    try {
      return work();
    } finally {
      this.grouped = null;
      if (group.changes.length > 0) this.record(group.changes, group.words ?? undefined);
    }
  }

  /** Whether `entry` can be undone now: not undone, its values still what it set, nothing newer changed them, and they can be written back. */
  canUndo(entry: ChangeEntry): boolean {
    if (entry.undone) return false;
    const keys = new Set(entry.changes.map((change) => change.key));
    for (const newer of this.list) {
      if (newer.id === entry.id) break;
      if (!newer.undone && newer.changes.some((change) => keys.has(change.key))) return false;
    }
    return entry.changes.every((change) => {
      const { prefix, field } = prefixOf(change.key);
      const applier = this.appliers.get(prefix);
      return applier !== undefined && sameValue(applier.read(field), change.to);
    });
  }

  /**
   * Undo for one entry (Recently changed, Settings › Agents). The newest
   * step of this session is Edit › Undo itself; an older entry is put back
   * on its own, and that is a step ❖Z can take back. False when it can't be.
   */
  async undoEntry(id: number): Promise<boolean> {
    const entry = this.list.find((each) => each.id === id);
    if (!entry || !this.canUndo(entry) || this.undo.state.busy) return false;
    if (this.steps.get(id) === this.undo.state.undoStep && this.undo.state.undoStep !== null) return this.undo.undo();
    this.revert(entry);
    this.undo.push({ name: entry.words.menu, undo: () => this.reapply(entry), do: () => this.revert(entry) });
    this.steps.delete(id);
    return true;
  }

  /** Writes what's left to the file now (the shell is quitting). */
  async flush(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.save();
  }

  /** The same setting again, by the same hand, soon: the newest entry now ends at the new value. */
  private join(moved: readonly Change[], by: Actor | null, at: number): boolean {
    const [only] = moved;
    const newest = this.list[0];
    const was = newest?.changes[0];
    if (!only || moved.length !== 1 || !newest || !was || newest.changes.length !== 1 || newest.undone) return false;
    if (was.key !== only.key || !sameActor(newest.by, by) || at - newest.at > JOIN_MS) return false;
    // Only while ❖Z would still take back that entry (nothing came between).
    if (this.steps.get(newest.id) !== this.undo.state.undoStep) return false;
    const changes = [{ key: only.key, from: was.from, to: only.to }];
    const words = this.describe(changes) ?? newest.words;
    const joined: ChangeEntry = { ...newest, at, changes, words: { ...words, from: newest.words.from } };
    // The undo step reads the entry it was made for: change that one in place.
    Object.assign(newest, joined);
    this.list = [...this.list];
    this.changed();
    return true;
  }

  private write(entry: ChangeEntry, way: "from" | "to"): void {
    const changes = way === "from" ? [...entry.changes].reverse() : entry.changes;
    this.replaying = true;
    try {
      for (const change of changes) {
        const { prefix, field } = prefixOf(change.key);
        try {
          this.appliers.get(prefix)?.write(field, change[way]);
        } catch (error) {
          // A value the store refuses (a file edited by hand): the rest still goes back.
          console.error(`dashi-shell: could not put ${change.key} back:`, error);
        }
      }
    } finally {
      this.replaying = false;
    }
  }

  private revert(entry: ChangeEntry): void {
    this.write(entry, "from");
    this.mark(entry, true);
  }

  private reapply(entry: ChangeEntry): void {
    this.write(entry, "to");
    this.mark(entry, false);
  }

  private mark(entry: ChangeEntry, undone: boolean): void {
    entry.undone = undone;
    this.list = [...this.list];
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
    if (!this.path) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_MS);
  }

  private async save(): Promise<void> {
    if (!this.path) return;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify({ version: 1, entries: this.list })}\n`, { mode: 0o600 });
    } catch (error) {
      console.error("dashi-shell: could not keep Settings' recent changes:", error);
    }
  }
}
