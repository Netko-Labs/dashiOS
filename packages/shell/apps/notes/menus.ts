/**
 * Notes' menus in the menu bar (the kit's `useAppMenus`): File (new note,
 * new folder, delete), Note (pin, move, checklist item), and View (edit or
 * preview, and which folder shows). The shortcuts shown are real: Metal
 * reports no Ctrl combinations to the app, but the shell matches a ❖ chord
 * against the menus and chooses the item (app-menus/shortcut.ts). Item ids are
 * checked by the shell (letters, digits, `.:_-`), and folder names are not
 * that, so folders are named by their place in the list.
 */

import type { MenuSpec } from "../kit/index.ts";
import type { Source } from "./list.ts";
import { DEFAULT_FOLDER_NAME } from "./names.ts";

export interface MenuContext {
  folders: readonly string[];
  source: Source;
  mode: "edit" | "preview";
  /** A live note is open (not one in Recently Deleted). */
  hasNote: boolean;
  /** A deleted note is open. */
  hasDeleted: boolean;
  pinned: boolean;
  /** The folder of the open note ("" is the default folder). */
  noteFolder: string;
  /** Any deleted notes at all. */
  anyDeleted: boolean;
  actions: {
    newNote(): void;
    newFolder(): void;
    renameFolder(name: string): void;
    deleteFolder(name: string): void;
    deleteNote(): void;
    restore(): void;
    purge(): void;
    emptyTrash(): void;
    pin(): void;
    moveTo(folder: string): void;
    addChecklistItem(): void;
    setMode(mode: "edit" | "preview"): void;
    show(source: Source): void;
    focusSearch(): void;
  };
}

/** The menus, and what choosing each row does. */
export function notesMenus(context: MenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const { actions, folders, source, hasNote, hasDeleted } = context;
  const inTrash = source.kind === "trash";
  const openFolder = source.kind === "folder" && source.name !== "" ? source.name : null;
  const places = ["", ...folders];

  const file: MenuSpec = {
    id: "file",
    items: [
      { id: "note:new", label: "New Note", shortcut: "❖N", enabled: !inTrash },
      { id: "folder:new", label: "New Folder", shortcut: "⇧❖N" },
      { type: "separator" },
      { id: "note:delete", label: "Delete Note", enabled: hasNote },
      { id: "note:restore", label: "Restore Note", enabled: hasDeleted },
      { id: "note:purge", label: "Delete Note Forever…", enabled: hasDeleted },
      { id: "trash:empty", label: "Delete All Recently Deleted…", enabled: context.anyDeleted },
      { type: "separator" },
      { id: "folder:rename", label: "Rename Folder", enabled: openFolder !== null },
      { id: "folder:delete", label: "Delete Folder…", enabled: openFolder !== null },
    ],
  };
  const note: MenuSpec = {
    id: "note",
    title: "Note",
    items: [
      { id: "note:pin", label: context.pinned ? "Unpin Note" : "Pin Note", enabled: hasNote },
      { id: "note:checklist", label: "Add Checklist Item", shortcut: "⇧❖L", enabled: hasNote },
      { type: "separator" },
      ...places.map((place, index) => ({
        id: `move:${index}`,
        label: `Move to ${place === "" ? DEFAULT_FOLDER_NAME : place}`,
        enabled: hasNote,
        checked: hasNote ? place === context.noteFolder : false,
      })),
    ],
  };
  const view: MenuSpec = {
    id: "view",
    items: [
      { id: "mode:edit", label: "Edit", checked: context.mode === "edit" },
      { id: "mode:preview", label: "Preview", checked: context.mode === "preview" },
      { type: "separator" },
      { id: "show:all", label: "All Notes", checked: source.kind === "all" },
      ...places.map((place, index) => ({
        id: `show:${index}`,
        label: place === "" ? DEFAULT_FOLDER_NAME : place,
        checked: source.kind === "folder" && source.name === place,
      })),
      { id: "show:trash", label: "Recently Deleted", checked: inTrash },
      { type: "separator" },
      { id: "search", label: "Search", shortcut: "❖F" },
    ],
  };

  const run = (id: string): void => {
    const index = /^(?:move|show):(\d+)$/.exec(id);
    const place = index ? places[Number(index[1])] : undefined;
    if (id.startsWith("move:") && place !== undefined) return actions.moveTo(place);
    if (id.startsWith("show:") && place !== undefined) return actions.show({ kind: "folder", name: place });
    switch (id) {
      case "note:new":
        return actions.newNote();
      case "folder:new":
        return actions.newFolder();
      case "note:delete":
        return actions.deleteNote();
      case "note:restore":
        return actions.restore();
      case "note:purge":
        return actions.purge();
      case "trash:empty":
        return actions.emptyTrash();
      case "folder:rename":
        return openFolder === null ? undefined : actions.renameFolder(openFolder);
      case "folder:delete":
        return openFolder === null ? undefined : actions.deleteFolder(openFolder);
      case "note:pin":
        return actions.pin();
      case "note:checklist":
        return actions.addChecklistItem();
      case "mode:edit":
        return actions.setMode("edit");
      case "mode:preview":
        return actions.setMode("preview");
      case "show:all":
        return actions.show({ kind: "all" });
      case "show:trash":
        return actions.show({ kind: "trash" });
      case "search":
        return actions.focusSearch();
    }
  };
  return { menus: [file, note, view], run };
}
