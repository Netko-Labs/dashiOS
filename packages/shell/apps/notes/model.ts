/**
 * Notes' state: what the sidebar shows, which note is open, and the text being
 * typed. A store with the usual subscribe/getSnapshot pair, over a NotesStore.
 *
 * Typing is kept apart from the disk: `draft` is what the editor shows, and a
 * save follows a short quiet (`SAVE_MS`) or the next thing that would leave
 * the note (another note, a delete, quitting). A file that changes on disk
 * (`reload`, from the folder watcher) replaces the draft when nothing typed
 * is waiting to be saved. When something is, it is saved at once, and every
 * save first reads the file again (conflict.ts): if the file changed since
 * the editor read it, and differently from what was typed, the file's
 * version stays the note and the typing is kept beside it as "Title
 * (conflict)", which the editor goes on with, and a line in the window says
 * so. A change on disk is never written over without a word.
 *
 * Deleting a note can be taken back: Edit › Undo Delete Note puts it back
 * from Recently Deleted and opens it (`undo`, @dashi/ui's stack). What is
 * typed in the open note can be taken back too (`textUndo`, a stack of its
 * own that starts over with each note): a run of typing is one step, and a
 * format command (Bold, Checklist) is its own, named for it. Edit › Undo
 * takes back the typing first, then the notes' steps.
 *
 * The body's caret and selection live here as well (`selection`), so a
 * format command, Undo, a ticked box and Find Next can change the text and
 * put the caret where it belongs.
 */

import { UndoStack, type UndoState } from "@dashi/ui";

import { conflictNotice, conflictTitle, saveOutcome } from "./conflict.ts";
import { plainError } from "./errors.ts";
import { currentMatch, findMatches, nextMatch } from "./find.ts";
import { continueList, type Selection, toggleCheck } from "./format.ts";
import { caretAfter, FORMAT_NAMES, type FormatCommand, formatted } from "./formats.ts";
import { neighbor, type Row, type Source, step, visibleRows } from "./list.ts";
import type { NotesStore } from "./store.ts";
import { serializeNote } from "./text.ts";
import type { DeletedNote, Note } from "./types.ts";

export const SAVE_MS = 600;

/** A step of typing, as Undo puts it back: the text and where the caret was. */
interface TextState {
  draft: Draft;
  selection: Selection;
}

export interface Draft {
  title: string;
  body: string;
}

export interface NotesState {
  notes: Note[];
  folders: string[];
  deleted: DeletedNote[];
  source: Source;
  query: string;
  /** A note id (or, in Recently Deleted, a file name). */
  selected: string | null;
  draft: Draft | null;
  /** The body's caret and selection (offsets into `draft.body`). */
  selection: Selection;
  /** Changes whenever the editor's fields must start over (another note opened, a file changed under it). */
  session: number;
  /** The title field asks for the keyboard (a new note). */
  focusTitle: boolean;
  /** The last thing that went wrong, for a line in the window. */
  error: string | null;
  /** Something the person should know that isn't an error (a conflict copy was saved); cleared when another note opens. */
  notice: string | null;
}

const fingerprint = (draft: Draft): string => serializeNote({ ...draft, heading: false });

export class NotesModel {
  private state: NotesState = {
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
  /** Edit › Undo and Redo: deleted notes. */
  readonly undo = new UndoStack();
  /** Edit › Undo and Redo: what was typed in the open note, before `undo`. */
  readonly textUndo = new UndoStack();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** What the open note holds on disk as far as we know: the editor is clean when its draft matches. */
  private onDisk = "";

  constructor(
    readonly store: NotesStore,
    private readonly saveMs: number = SAVE_MS,
  ) {
    this.reload();
    this.select(this.rows()[0]?.id ?? null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NotesState => this.state;

  rows(): Row[] {
    return visibleRows(this.state.notes, this.state.deleted, this.state.source, this.state.query);
  }

  get dirty(): boolean {
    return this.timer !== null;
  }

  // Looking

  setSource(source: Source): void {
    this.leave();
    this.set({ source, query: "" });
    this.select(this.rows()[0]?.id ?? null);
  }

  setQuery(query: string): void {
    this.set({ query });
    const rows = this.rows();
    if (!rows.some((row) => row.id === this.state.selected)) this.select(rows[0]?.id ?? null);
  }

  /** Opens a note (null closes the editor). */
  select(id: string | null, options: { focusTitle?: boolean } = {}): void {
    if (id === this.state.selected && this.state.draft !== null) return;
    const shown = this.state.notice;
    this.leave();
    const note = this.isDeleted() ? undefined : this.state.notes.find((each) => each.id === id);
    const draft = note ? { title: note.title, body: note.body } : null;
    this.onDisk = draft ? fingerprint(draft) : "";
    // A notice from leaving this note (its typing saved as a conflict copy) stays; an older one goes.
    const notice = this.state.notice === shown ? null : this.state.notice;
    const end = draft?.body.length ?? 0;
    this.textUndo.clear();
    this.set({
      selected: id,
      draft,
      selection: { start: end, end },
      session: this.state.session + 1,
      focusTitle: options.focusTitle ?? false,
      error: null,
      notice,
    });
  }

  /** The person has read the error (its notice's x). */
  dismissError(): void {
    if (this.state.error !== null) this.set({ error: null });
  }

  /** The person has read the notice (a conflict copy was saved). */
  dismissNotice(): void {
    if (this.state.notice !== null) this.set({ notice: null });
  }

  moveSelection(by: -1 | 1): void {
    const id = step(this.rows(), this.state.selected, by);
    if (id) this.select(id);
  }

  // Writing

  edit(change: Partial<Draft>): void {
    const { draft, selected, selection } = this.state;
    if (!draft || !selected || this.isDeleted()) return;
    // Enter at the end of a list item starts the next one, the caret after its marker.
    const caret = selection.start === selection.end ? selection.start : -1;
    const continued = change.body === undefined ? null : continueList(draft.body, change.body, caret);
    const next = { title: change.title ?? draft.title, body: continued?.body ?? change.body ?? draft.body };
    if (next.title === draft.title && next.body === draft.body) return;
    const after = continued?.selection ?? caretAfter(draft.body, next.body, selection);
    // A run of typing is one step for Undo; a new line starts the next.
    const newLine = next.body.split("\n").length !== draft.body.split("\n").length;
    this.record({ draft, selection }, { draft: next, selection: after }, "Typing", newLine ? undefined : "typing");
    this.set({ draft: next, selection: after });
    this.later();
  }

  /** The body's caret moved or its selection changed (the field says so). */
  setSelection(selection: Selection): void {
    const { start, end } = this.state.selection;
    if (selection.start !== start || selection.end !== end) this.set({ selection });
  }

  /** Format › Bold, Italic, Checklist…: the open note's body, changed where the selection is. */
  format(command: FormatCommand): void {
    const { draft, selection } = this.state;
    if (!draft || !this.state.selected || this.isDeleted()) return;
    const edited = formatted(draft.body, selection, command);
    if (edited.body === draft.body) return;
    const next = { ...draft, body: edited.body };
    this.record({ draft, selection }, { draft: next, selection: edited.selection }, FORMAT_NAMES[command]);
    this.set({ draft: next, selection: edited.selection });
    this.later();
  }

  /** Ticks or unticks the checklist item on `line` of the body, and saves it at once; the caret stays. */
  toggleCheck(line: number): void {
    const { draft, selection } = this.state;
    if (!draft || this.isDeleted()) return;
    const body = toggleCheck(draft.body, line);
    if (body === draft.body) return;
    const next = { ...draft, body };
    this.record({ draft, selection }, { draft: next, selection }, "Checkbox");
    this.set({ draft: next });
    this.flush();
  }

  /** Edit › Find Next and Find Previous: selects the next place in the body that holds the search's words; false when none does. */
  /** Leaving Find: the match the selection is on stays selected, else the next one is; false when the note has none. */
  findCurrent(): boolean {
    const { draft, query, selection } = this.state;
    const match = draft ? currentMatch(findMatches(draft.body, query), selection) : null;
    if (match) this.set({ selection: match });
    return match !== null;
  }

  findNext(step: 1 | -1): boolean {
    const { draft, query, selection } = this.state;
    const match = draft ? nextMatch(findMatches(draft.body, query), selection, step) : null;
    if (match) this.set({ selection: match });
    return match !== null;
  }

  /** What Edit › Undo and Redo show: the typing's step first, else the notes' (a deleted note). */
  undoState(): UndoState {
    const text = this.textUndo.state;
    const notes = this.undo.state;
    return {
      canUndo: text.canUndo || notes.canUndo,
      canRedo: text.canRedo || notes.canRedo,
      undoName: text.canUndo ? text.undoName : notes.undoName,
      redoName: text.canRedo ? text.redoName : notes.redoName,
      busy: text.busy || notes.busy,
      undoStep: text.canUndo ? text.undoStep : notes.undoStep,
    };
  }

  /** Writes what is typed, unless the file changed under it (conflict.ts). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const { draft, selected } = this.state;
    if (!draft || !selected || this.isDeleted()) return;
    const mine = fingerprint(draft);
    const current = this.readFresh(selected);
    const disk = current ? fingerprint(current) : null;
    switch (saveOutcome({ base: this.onDisk, disk, mine })) {
      case "nothing":
        // Nothing typed since it was read or last written: leave the file (and its modified time) alone.
        return;
      case "same":
        this.onDisk = mine;
        return;
      case "theirs":
        if (current) this.adopt(current);
        return;
      case "conflict":
        if (current) this.keepBoth(draft, current);
        return;
      case "ours":
        break;
    }
    try {
      const saved = this.store.save(selected, draft, { rename: false });
      this.onDisk = fingerprint(saved);
      // Only this note changed: it is updated in place, without reading the whole folder again.
      this.set({ notes: this.state.notes.map((note) => (note.id === saved.id ? saved : note)), selected: saved.id, error: null });
    } catch (error) {
      this.set({ error: plainError(error, "save") });
    }
  }

  /** A new note in the open folder (the default folder from All Notes or a search). */
  newNote(): void {
    this.leave();
    const { source } = this.state;
    const folder = source.kind === "folder" ? source.name : "";
    try {
      const note = this.store.create({ folder });
      this.set({ source: source.kind === "trash" ? { kind: "all" } : source, query: "" });
      this.refresh();
      this.select(note.id, { focusTitle: true });
    } catch (error) {
      this.set({ error: plainError(error, "create") });
    }
  }

  trashSelected(): void {
    // What is typed goes to Recently Deleted with the note; saving it can rename the file, so the id is read after.
    this.flush();
    const { selected } = this.state;
    if (!selected || this.isDeleted()) return;
    let trashed: string | null = null;
    this.drop(selected, () => {
      trashed = this.store.trash(selected);
    });
    if (trashed !== null) this.pushDelete(trashed);
  }

  /** Edit › Undo or Redo (the typing's step first); a step that fails says why in the window. */
  async undoStep(way: "undo" | "redo"): Promise<void> {
    const text = this.textUndo.state;
    const stack = (way === "undo" ? text.canUndo : text.canRedo) ? this.textUndo : this.undo;
    try {
      await (way === "undo" ? stack.undo() : stack.redo());
    } catch (error) {
      this.set({ error: plainError(error, "change") });
    }
  }

  /** A note went to Recently Deleted as `name`: Undo restores and opens it, Redo deletes it again. */
  private pushDelete(name: string): void {
    let trashed = name;
    let id: string | null = null;
    this.undo.push({
      name: "Delete Note",
      undo: () => {
        id = this.store.restore(trashed);
        this.leave();
        // Shown where it is: in All Notes when Recently Deleted was open.
        if (this.state.source.kind === "trash") this.set({ source: { kind: "all" }, query: "" });
        this.refresh();
        this.select(id);
      },
      do: () => {
        const live = id;
        if (live === null) return;
        this.flush();
        const after = neighbor(this.rows(), live);
        trashed = this.store.trash(live);
        this.refresh();
        this.set({ selected: null, draft: null });
        this.select(after === live ? null : after);
      },
    });
  }

  restoreSelected(): void {
    const { selected } = this.state;
    if (!selected || !this.isDeleted()) return;
    this.drop(selected, () => this.store.restore(selected));
  }

  purgeSelected(): void {
    const { selected } = this.state;
    if (!selected || !this.isDeleted()) return;
    this.drop(selected, () => this.store.purge(selected));
  }

  emptyTrash(): void {
    this.attempt(() => this.store.emptyTrash());
    this.select(null);
    this.refresh();
  }

  togglePin(id: string | null = this.state.selected): void {
    const target = this.settle(id);
    const note = this.state.notes.find((each) => each.id === target);
    if (!target || !note) return;
    this.attempt(() => this.store.setPinned(target, !note.pinned));
    this.refresh();
  }

  moveTo(folder: string, id: string | null = this.state.selected): void {
    const target = this.settle(id);
    if (!target || this.isDeleted()) return;
    const wasOpen = target === this.state.selected;
    this.attempt(() => {
      const next = this.store.move(target, folder);
      this.refresh();
      if (wasOpen) this.set({ selected: next });
    });
  }

  createFolder(name: string): string | null {
    return this.attempt(() => {
      const made = this.store.createFolder(name);
      this.refresh();
      return made;
    });
  }

  renameFolder(from: string, name: string): void {
    this.flush();
    this.attempt(() => {
      const to = this.store.renameFolder(from, name);
      const { source, selected } = this.state;
      this.refresh();
      const moved = selected?.startsWith(`${from}/`) ? `${to}/${selected.slice(from.length + 1)}` : selected;
      this.set({ source: source.kind === "folder" && source.name === from ? { kind: "folder", name: to } : source, selected: moved });
    });
  }

  deleteFolder(name: string): void {
    this.flush();
    this.attempt(() => this.store.deleteFolder(name));
    this.refresh();
    if (this.state.source.kind === "folder" && this.state.source.name === name) this.setSource({ kind: "all" });
    else if (!this.state.notes.some((note) => note.id === this.state.selected)) this.select(this.rows()[0]?.id ?? null);
  }

  /** The folder changed on disk (another program, a sync, an agent): look again. */
  reload(): void {
    this.refresh();
    const { selected, draft } = this.state;
    if (!selected || this.isDeleted()) {
      if (selected && !this.state.deleted.some((note) => note.id === selected)) this.select(this.rows()[0]?.id ?? null);
      return;
    }
    const note = this.state.notes.find((each) => each.id === selected);
    if (!note) {
      // Gone from under the editor. Typing that was not saved yet is not lost: it becomes a note again.
      if (this.dirty && draft) {
        this.flushAsNew(draft);
      } else {
        this.select(neighbor(this.rows(), selected));
      }
      return;
    }
    if (fingerprint(note) === this.onDisk) return;
    // Typing is waiting: save it now, which keeps both versions if they differ (flush).
    if (this.dirty) this.flush();
    else this.adopt(note);
  }

  dispose(): void {
    this.flush();
    this.settleName();
    this.listeners.clear();
  }

  // Internals

  /** The note as its file holds it now, or null when it can't be read (gone, unreadable). */
  private readFresh(id: string): Note | null {
    try {
      return this.store.read(id);
    } catch {
      return null;
    }
  }

  /** The editor takes the file's version of the open note (what was typed before it can't be undone into it). */
  private adopt(note: Note): void {
    this.onDisk = fingerprint(note);
    this.textUndo.clear();
    const clamp = (at: number): number => Math.min(at, note.body.length);
    const selection = { start: clamp(this.state.selection.start), end: clamp(this.state.selection.end) };
    this.set({ draft: { title: note.title, body: note.body }, selection, session: this.state.session + 1 });
  }

  /** Records a change of the open note's text for Edit › Undo; steps with the same `joins`, close together, are one. */
  private record(before: TextState, after: TextState, name: string, joins?: string): void {
    this.textUndo.push({
      name,
      ...(joins !== undefined ? { joins } : {}),
      undo: () => this.restore(before),
      do: () => this.restore(after),
    });
  }

  /** Puts the open note's text back as a step had it. */
  private restore(text: TextState): void {
    if (!this.state.draft || this.isDeleted()) return;
    this.set({ draft: text.draft, selection: text.selection });
    this.later();
  }

  /**
   * Both the file and the typing changed: the file's version stays the note,
   * and the typing becomes a new note beside it, "Title (conflict)", in the
   * same folder. The editor goes on with that copy, so what is on screen
   * doesn't change under the person's fingers, and the window says so.
   */
  private keepBoth(draft: Draft, current: Note): void {
    const title = conflictTitle(draft.title || current.title);
    let copy: Note;
    try {
      copy = this.store.create({ folder: current.folder, title, body: draft.body });
    } catch (error) {
      // Nothing is written over: the typing stays in the editor, unsaved, and the line says why.
      this.set({ error: plainError(error, "save") });
      return;
    }
    this.onDisk = fingerprint(copy);
    this.refresh();
    this.set({ selected: copy.id, draft: { title: copy.title, body: draft.body }, error: null, notice: conflictNotice(copy.title) });
  }

  /** The open row is in Recently Deleted (its ids are file names there, not note ids). */
  private isDeleted(): boolean {
    return this.state.source.kind === "trash";
  }

  /** `id`, as it is after the open note's pending typing is saved (which can rename it). */
  private settle(id: string | null): string | null {
    if (id !== null && id === this.state.selected) {
      this.flush();
      return this.state.selected;
    }
    return id;
  }

  /** Before the open note is left: save it, and drop a new note nothing was typed in. */
  private leave(): void {
    const { selected, draft } = this.state;
    this.flush();
    if (selected && draft && !this.isDeleted() && draft.title.trim() === "" && draft.body.trim() === "") {
      try {
        if (this.store.discardIfEmpty(selected)) this.refresh();
      } catch {
        // Already gone.
      }
    }
    this.settleName();
  }

  /** The open note's file takes its title's name, once it is left: saves while typing don't rename it (store.ts `save`). */
  private settleName(): void {
    const { selected } = this.state;
    if (!selected || this.isDeleted() || !this.state.notes.some((note) => note.id === selected)) return;
    try {
      const id = this.store.settleName(selected);
      if (id === selected) return;
      this.refresh();
      this.set({ selected: id });
    } catch {
      // Gone, or the name is taken by something we can't move over: it keeps the name it has.
    }
  }

  private later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.saveMs);
  }

  private flushAsNew(draft: Draft): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const note = this.attempt(() => this.store.create({ folder: "", title: draft.title, body: draft.body }));
    this.refresh();
    if (note) this.set({ selected: note.id });
  }

  /** Runs a store change that takes the open note out of the list, and moves on to its neighbor. */
  private drop(id: string, action: () => unknown): void {
    const after = neighbor(this.rows(), id);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.attempt(action) === null) return;
    this.refresh();
    this.set({ selected: null, draft: null });
    this.select(after === id ? null : after);
  }

  private attempt<T>(action: () => T): T | null {
    try {
      return action();
    } catch (error) {
      this.set({ error: plainError(error, "change") });
      return null;
    }
  }

  private refresh(): void {
    try {
      const { notes, folders, deleted } = this.store.scan();
      this.set({ notes, folders, deleted });
    } catch (error) {
      this.set({ error: plainError(error, "read") });
    }
  }

  private set(change: Partial<NotesState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
