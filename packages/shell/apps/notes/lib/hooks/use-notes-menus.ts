/**
 * The window's menu bar menus (menus.ts), every command with its ❖ chord,
 * and what each does here. Edit › Undo and Redo: the typing first, then a
 * deleted note (model.undoState); both stacks are watched.
 */

import { useUndo } from "@dashi/ui";
import { useAppMenus } from "../../../kit/index.ts";
import { notesMenus } from "../menus.ts";
import type { NotesModel } from "../model.ts";
import type { Focus } from "./use-focus.ts";
import type { NoteActions } from "./use-note-actions.ts";
import type { NotesData } from "./use-notes-data.ts";
import type { Overlays } from "./use-overlays.ts";

export function useNotesMenus({
  model,
  data,
  overlays,
  focus,
  actions,
  press,
}: {
  model: NotesModel;
  data: NotesData;
  overlays: Overlays;
  focus: Focus;
  actions: NoteActions;
  /** Sends a key to the field with the keyboard ("ctrl-c"): Edit's Cut, Copy, Paste and Select All. */
  press: (keystroke: string) => void;
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
      deleteNote: () => model.trashSelected(),
      restore: () => model.restoreSelected(),
      purge: () => row && setSheet({ kind: "purge", title: row.title }),
      emptyTrash: () => setSheet({ kind: "empty-trash", count: state.deleted.length }),
      pin: () => model.togglePin(),
      moveTo: (folder) => model.moveTo(folder),
      format: actions.format,
      show: (source) => model.setSource(source),
      undo: () => void model.undoStep("undo"),
      redo: () => void model.undoStep("redo"),
      cut: () => press("ctrl-x"),
      copy: () => press("ctrl-c"),
      paste: () => press("ctrl-v"),
      selectAll: () => press("ctrl-a"),
      find: focus.search,
      findNext: (step) => {
        if (model.findNext(step)) focus.focusBody();
      },
    },
  });
  useAppMenus(menus, run);
}
