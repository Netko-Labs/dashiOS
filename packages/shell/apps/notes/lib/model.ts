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

import type { NotesStore } from "../../../src/shared/notes/store.ts";
import { plainError } from "./errors.ts";
import { neighbor, type Source, step } from "./list.ts";
import { NotesSaving } from "./saving.ts";
import { fingerprint, SAVE_MS } from "./state.ts";

export class NotesModel extends NotesSaving {
  constructor(store: NotesStore, saveMs: number = SAVE_MS) {
    super(store, saveMs);
    this.reload();
    this.select(this.rows()[0]?.id ?? null);
  }

  // Looking

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

  // Notes and folders

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

  /** A note went to Recently Deleted as `name`: Undo restores and opens it, Redo deletes it again. */
  protected pushDelete(name: string): void {
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
    this.clearListeners();
  }

  /** Runs a store change that takes the open note out of the list, and moves on to its neighbor. */
  protected drop(id: string, action: () => unknown): void {
    const after = neighbor(this.rows(), id);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.attempt(action) === null) return;
    this.refresh();
    this.set({ selected: null, draft: null });
    this.select(after === id ? null : after);
  }
}
