/**
 * Saving the open note: a write after a short quiet or when the note is
 * left, and the care taken when the file changed on disk meanwhile
 * (conflict.ts): the file's version stays and the typing is kept beside it.
 */

import type { NotesStore } from "../../../src/shared/notes/store.ts";
import type { Note } from "../../../src/shared/notes/types.ts";
import { conflictNotice, conflictTitle, saveOutcome } from "./conflict.ts";
import { plainError } from "./errors.ts";
import { type Draft, fingerprint, SAVE_MS } from "./state.ts";
import { NotesTyping } from "./typing.ts";

export abstract class NotesSaving extends NotesTyping {
  protected timer: ReturnType<typeof setTimeout> | null = null;
  /** What the open note holds on disk as far as we know: the editor is clean when its draft matches. */
  protected onDisk = "";

  constructor(
    store: NotesStore,
    protected readonly saveMs: number = SAVE_MS,
  ) {
    super(store);
  }

  get dirty(): boolean {
    return this.timer !== null;
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

  protected later(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.saveMs);
  }

  /** The editor takes the file's version of the open note (what was typed before it can't be undone into it). */
  protected adopt(note: Note): void {
    this.onDisk = fingerprint(note);
    this.textUndo.clear();
    const clamp = (at: number): number => Math.min(at, note.body.length);
    const selection = { start: clamp(this.state.selection.start), end: clamp(this.state.selection.end) };
    this.set({ draft: { title: note.title, body: note.body }, selection, session: this.state.session + 1 });
  }

  /**
   * Both the file and the typing changed: the file's version stays the note,
   * and the typing becomes a new note beside it, "Title (conflict)", in the
   * same folder. The editor goes on with that copy, so what is on screen
   * doesn't change under the person's fingers, and the window says so.
   */
  protected keepBoth(draft: Draft, current: Note): void {
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

  /** `id`, as it is after the open note's pending typing is saved (which can rename it). */
  protected settle(id: string | null): string | null {
    if (id !== null && id === this.state.selected) {
      this.flush();
      return this.state.selected;
    }
    return id;
  }

  /** Before the open note is left: save it, and drop a new note nothing was typed in. */
  protected leave(): void {
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
  protected settleName(): void {
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

  protected flushAsNew(draft: Draft): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const note = this.attempt(() => this.store.create({ folder: "", title: draft.title, body: draft.body }));
    this.refresh();
    if (note) this.set({ selected: note.id });
  }
}
