/**
 * What the person does to the open note from the window: a format command
 * (which hands it the keyboard), and the menus that act on a note or a
 * folder at a point (a row's, a folder's, the toolbar's Move).
 */

import type { MenuItem } from "@dashi/ui";
import { DEFAULT_FOLDER_NAME } from "../../../../src/shared/notes/index.ts";
import type { FormatCommand } from "../formats.ts";
import type { Row } from "../list.ts";
import type { NotesModel } from "../model.ts";
import type { NotesData } from "./use-notes-data.ts";
import type { Overlays } from "./use-overlays.ts";

export interface NoteActions {
  format: (command: FormatCommand) => void;
  /** The "Move to" items for a note (the selected one when `id` is null), the folder it is in ticked. */
  moveItems: (id: string | null, current: string) => MenuItem[];
  openRowMenu: (target: Row, x: number, y: number) => void;
  openFolderMenu: (name: string, x: number, y: number) => void;
}

export function useNoteActions({
  model,
  data,
  overlays,
  focusBody,
}: {
  model: NotesModel;
  data: NotesData;
  overlays: Overlays;
  focusBody: () => void;
}): NoteActions {
  const { state, inTrash } = data;
  const { setSheet, setMenu } = overlays;

  // A format command acts on the note and hands it the keyboard, the caret where the command left it.
  const format = (command: FormatCommand): void => {
    if (!state.draft || inTrash) return;
    model.format(command);
    focusBody();
  };

  const moveItems = (id: string | null, current: string): MenuItem[] =>
    [{ name: "", label: DEFAULT_FOLDER_NAME }, ...state.folders.map((name) => ({ name, label: name }))].map((folder) => ({
      label: `Move to ${folder.label}`,
      // Where the note is: ticked, and not a place to move it to, so the menu never opens lit on it.
      checked: folder.name === current,
      disabled: folder.name === current,
      onPress: () => model.moveTo(folder.name, id),
    }));

  const openRowMenu = (target: Row, x: number, y: number): void => {
    model.select(target.id);
    setMenu({
      x,
      y,
      items: target.deleted
        ? [
            { label: "Restore", onPress: () => model.restoreSelected() },
            { label: "Delete Forever…", onPress: () => setSheet({ kind: "purge", title: target.title }) },
          ]
        : [
            { label: target.pinned ? "Unpin Note" : "Pin Note", onPress: () => model.togglePin(target.id) },
            ...moveItems(target.id, target.folder),
            { label: "Delete", onPress: () => model.trashSelected() },
          ],
    });
  };

  const openFolderMenu = (name: string, x: number, y: number): void => {
    setMenu({
      x,
      y,
      items: [
        { label: "Rename Folder…", onPress: () => setSheet({ kind: "rename-folder", name }) },
        { label: "Delete Folder…", onPress: () => setSheet({ kind: "delete-folder", name, count: state.notes.filter((note) => note.folder === name).length }) },
      ],
    });
  };

  return { format, moveItems, openRowMenu, openFolderMenu };
}
