/**
 * Typing in the open note: the edit, its caret and selection, a format
 * command, a ticked box, Find Next, and Edit › Undo and Redo for them. What
 * is typed is the `draft`; writing it to the file is saving.ts.
 */

import { UndoStack, type UndoState } from "@dashi/ui";
import { plainError } from "./errors.ts";
import { currentMatch, findMatches, nextMatch } from "./find.ts";
import { continueList, type Selection, toggleCheck } from "./format.ts";
import { caretAfter, FORMAT_NAMES, type FormatCommand, formatted } from "./formats.ts";
import type { Draft, TextState } from "./state.ts";
import { NotesBase } from "./store-base.ts";

export abstract class NotesTyping extends NotesBase {
  /** Edit › Undo and Redo: deleted notes. */
  readonly undo = new UndoStack();
  /** Edit › Undo and Redo: what was typed in the open note, before `undo`. */
  readonly textUndo = new UndoStack();

  /** Writes what is typed, unless the file changed under it (conflict.ts). */
  abstract flush(): void;
  /** Writes what is typed after a short quiet. */
  protected abstract later(): void;

  // Writing

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

  /** Records a change of the open note's text for Edit › Undo; steps with the same `joins`, close together, are one. */
  protected record(before: TextState, after: TextState, name: string, joins?: string): void {
    this.textUndo.push({
      name,
      ...(joins !== undefined ? { joins } : {}),
      undo: () => this.restore(before),
      do: () => this.restore(after),
    });
  }

  /** Puts the open note's text back as a step had it. */
  protected restore(text: TextState): void {
    if (!this.state.draft || this.isDeleted()) return;
    this.set({ draft: text.draft, selection: text.selection });
    this.later();
  }
}
