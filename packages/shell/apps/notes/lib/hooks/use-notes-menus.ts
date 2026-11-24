/**
 * The window's menu bar menus (menus.ts), every command with its ❖ chord,
 * and what each does here. Edit › Undo and Redo: the typing first, then a
 * deleted note (model.undoState); both stacks are watched.
 */

import { useUndo } from "@dashi/ui";
import { systemClipboard, useAppMenus } from "../../../kit/index.ts";
import { htmlToMarkdown } from "../html.ts";
import { notesMenus } from "../menus.ts";
import type { NotesModel } from "../model.ts";
import type { Focus } from "./use-focus.ts";
import type { NoteActions } from "./use-note-actions.ts";
import type { NotesData } from "./use-notes-data.ts";
import type { Overlays } from "./use-overlays.ts";

const clipboard = systemClipboard();

/**
 * Edit's Cut, Copy and Paste in the body being edited: the selection's
 * Markdown goes to the clipboard (the field would copy the drawn words), and
 * a browser's rich text comes in as Markdown. Elsewhere, and without
 * wl-clipboard, the key goes to the field with the keyboard.
 */
function clipboardActions(model: NotesModel, editing: boolean, press: (keystroke: string) => void): { cut(): void; copy(): void; paste(): void } {
  const take = (cut: boolean): void => {
    const text = model.selectedSource();
    if (!editing || text === "" || !clipboard.canWrite) return press(cut ? "ctrl-x" : "ctrl-c");
    void clipboard.writeText(text);
    if (cut) model.replaceSelection("", "Cut");
  };
  const paste = async (): Promise<void> => {
    const html = editing && clipboard.readHtml ? await clipboard.readHtml() : null;
    const markdown = html ? htmlToMarkdown(html) : "";
    if (markdown === "") press("ctrl-v");
    else model.replaceSelection(markdown, "Paste");
  };
  return { cut: () => take(true), copy: () => take(false), paste: () => void paste() };
}

export function useNotesMenus({
  model,
  data,
  overlays,
  focus,
  actions,
  press,
  typing,
}: {
  model: NotesModel;
  data: NotesData;
  overlays: Overlays;
  focus: Focus;
  actions: NoteActions;
  /** Sends a key to the field with the keyboard ("ctrl-c"): Edit's Cut, Copy, Paste and Select All. */
  press: (keystroke: string) => void;
  /** Whether a field has the keyboard. */
  typing?: () => boolean;
}): void {
  const { state, row, inTrash, openNote } = data;
  const { setSheet } = overlays;
  const folderCount = (name: string): number => state.notes.filter((note) => note.folder === name).length;
  useUndo(model.undo);
  useUndo(model.textUndo);
  const { menus, run } = notesMenus({
    folders: state.folders,
    source: state.source,
    hasNote: row !== null && !inTrash,
    hasDeleted: row !== null && inTrash,
    pinned: openNote?.pinned ?? false,
    noteFolder: openNote?.folder ?? "",
    anyDeleted: state.deleted.length > 0,
    hasSelection: state.draft !== null && state.selection.start !== state.selection.end,
    hasMatches: data.hasMatches,
    undo: model.undoState(),
    actions: {
      newNote: () => model.newNote(),
      newFolder: () => setSheet({ kind: "new-folder" }),
      renameFolder: (name) => setSheet({ kind: "rename-folder", name }),
      deleteFolder: (name) => setSheet({ kind: "delete-folder", name, count: folderCount(name) }),
      // ❖⌫ in a field deletes to the line's start (KB-6), as the compositor writes it for a field; elsewhere it deletes the note.
      deleteNote: () => {
        if (!typing?.()) return model.trashSelected();
        press("shift-home");
        press("backspace");
      },
      restore: () => model.restoreSelected(),
      purge: () => row && setSheet({ kind: "purge", title: row.title }),
      emptyTrash: () => setSheet({ kind: "empty-trash", count: state.deleted.length }),
      pin: () => model.togglePin(),
      moveTo: (folder) => model.moveTo(folder),
      format: actions.format,
      show: (source) => model.setSource(source),
      undo: () => void model.undoStep("undo"),
      redo: () => void model.undoStep("redo"),
      ...clipboardActions(model, state.editing, press),
      selectAll: () => press("ctrl-a"),
      find: () => {
        model.setEditing(false);
        focus.search();
      },
      findNext: (step) => {
        if (model.findNext(step)) focus.focusBody();
      },
    },
  });
  useAppMenus(menus, run);
}
