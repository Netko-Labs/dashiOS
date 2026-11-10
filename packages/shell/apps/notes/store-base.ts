/**
 * The notes model's plumbing: the state it holds (subscribe/getSnapshot),
 * the rows the list shows, reading the folder again, and running a change
 * to the files that says why in the window when it fails.
 */

import type { NotesStore } from "../../src/shared/notes/store.ts";
import type { Note } from "../../src/shared/notes/types.ts";
import { plainError } from "./errors.ts";
import { type Row, visibleRows } from "./list.ts";
import type { NotesState } from "./state.ts";

export abstract class NotesBase {
  protected state: NotesState = {
    notes: [],
    folders: [],
    deleted: [],
    source: { kind: "all" },
    query: "",
    selected: null,
    draft: null,
    selection: { start: 0, end: 0 },
    session: 0,
    focusTitle: false,
    error: null,
    notice: null,
  };
  private readonly listeners = new Set<() => void>();

  constructor(readonly store: NotesStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NotesState => this.state;

  rows(): Row[] {
    return visibleRows(this.state.notes, this.state.deleted, this.state.source, this.state.query);
  }

  // Internals

  /** The note as its file holds it now, or null when it can't be read (gone, unreadable). */
  protected readFresh(id: string): Note | null {
    try {
      return this.store.read(id);
    } catch {
      return null;
    }
  }

  /** The open row is in Recently Deleted (its ids are file names there, not note ids). */
  protected isDeleted(): boolean {
    return this.state.source.kind === "trash";
  }

  protected attempt<T>(action: () => T): T | null {
    try {
      return action();
    } catch (error) {
      this.set({ error: plainError(error, "change") });
      return null;
    }
  }

  protected refresh(): void {
    try {
      const { notes, folders, deleted } = this.store.scan();
      this.set({ notes, folders, deleted });
    } catch (error) {
      this.set({ error: plainError(error, "read") });
    }
  }

  protected set(change: Partial<NotesState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  /** Forget the listeners (the window is closing). */
  protected clearListeners(): void {
    this.listeners.clear();
  }
}
