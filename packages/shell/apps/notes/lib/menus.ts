/**
 * Notes' menus in the menu bar (the kit's `useAppMenus`), the whole of what
 * Notes does (design.html PA-8): File (new note, new folder, delete), Edit
 * (Undo and Redo of the typing and of a deleted note; Cut, Copy, Paste and
 * Select All typed into the field with the keyboard, as its own keys would
 * be; Find in the note), Format (bold, italic, code, a link, headings, a
 * checklist), Note (pin, move), and View (which folder shows). The ❖
 * shortcuts are real: the shell matches a pressed chord against the enabled
 * rows (app-menus/shortcut.ts), and a chord no enabled row shows reaches the
 * field with the keyboard as its Ctrl chord, so ❖C still copies in the
 * search field while the note has nothing selected. Item ids are checked by
 * the shell (letters, digits, `.:_-`), and folder names are not that, so
 * folders are named by their place in the list.
 */

import { type UndoState, undoMenuItems } from "@dashi/ui";
import { DEFAULT_FOLDER_NAME } from "../../../src/shared/notes/names.ts";
import { enabledIds, type MenuSpec } from "../../kit/index.ts";
import type { FormatCommand } from "./formats.ts";
import type { Source } from "./list.ts";

export interface MenuContext {
  folders: readonly string[];
  source: Source;
  /** A live note is open (not one in Recently Deleted). */
  hasNote: boolean;
  /** A deleted note is open. */
  hasDeleted: boolean;
  pinned: boolean;
  /** The folder of the open note ("" is the default folder). */
  noteFolder: string;
  /** Any deleted notes at all. */
  anyDeleted: boolean;
  /** Text is selected in the note: Cut and Copy have something to take. */
  hasSelection: boolean;
  /** The search's words are in the open note: Find Next has somewhere to go. */
  hasMatches: boolean;
  /** What Edit › Undo and Redo would take back: the typing, else a deleted note. */
  undo: UndoState;
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
    format(command: FormatCommand): void;
    show(source: Source): void;
    undo(): void;
    redo(): void;
    cut(): void;
    copy(): void;
    paste(): void;
    selectAll(): void;
    find(): void;
    findNext(step: 1 | -1): void;
  };
}

/** Format's rows: the command, its label, and its chord. */
const FORMATS: ReadonlyArray<{ command: FormatCommand; label: string; shortcut?: string } | null> = [
  { command: "bold", label: "Bold", shortcut: "❖B" },
  { command: "italic", label: "Italic", shortcut: "❖I" },
  { command: "strike", label: "Strikethrough", shortcut: "⇧❖X" },
  { command: "code", label: "Code", shortcut: "❖E" },
  { command: "link", label: "Link", shortcut: "❖K" },
  null,
  { command: "heading1", label: "Heading 1", shortcut: "❖1" },
  { command: "heading2", label: "Heading 2", shortcut: "❖2" },
  { command: "heading3", label: "Heading 3", shortcut: "❖3" },
  { command: "body", label: "Body Text", shortcut: "❖0" },
  null,
  { command: "checklist", label: "Checklist", shortcut: "⇧❖L" },
];

/** The folder the open source is, when it is a folder of its own (not All Notes, not the default folder). */
const openFolderOf = (source: Source): string | null => (source.kind === "folder" && source.name !== "" ? source.name : null);

/** "" (the default folder) and the folders, in the order the Note and View menus list them. */
const placesOf = (folders: readonly string[]): string[] => ["", ...folders];

function fileMenu(context: MenuContext): MenuSpec {
  const { source, hasNote, hasDeleted } = context;
  const inTrash = source.kind === "trash";
  const openFolder = openFolderOf(source);
  return {
    id: "file",
    items: [
      { id: "note:new", label: "New Note", shortcut: "❖N", enabled: !inTrash },
      { id: "folder:new", label: "New Folder…", shortcut: "⇧❖N" },
      { type: "separator" },
      { id: "note:delete", label: "Delete Note", enabled: hasNote },
      { id: "note:restore", label: "Restore Note", enabled: hasDeleted },
      { id: "note:purge", label: "Delete Note Forever…", enabled: hasDeleted },
      { id: "trash:empty", label: "Delete All Recently Deleted…", enabled: context.anyDeleted },
      { type: "separator" },
      { id: "folder:rename", label: "Rename Folder…", enabled: openFolder !== null },
      { id: "folder:delete", label: "Delete Folder…", enabled: openFolder !== null },
    ],
  };
}

function editMenu(context: MenuContext): MenuSpec {
  const { hasNote, hasDeleted } = context;
  return {
    id: "edit",
    items: [
      ...undoMenuItems(context.undo),
      { type: "separator" },
      { id: "cut", label: "Cut", shortcut: "❖X", enabled: hasNote && context.hasSelection },
      { id: "copy", label: "Copy", shortcut: "❖C", enabled: (hasNote || hasDeleted) && context.hasSelection },
      { id: "paste", label: "Paste", shortcut: "❖V", enabled: hasNote },
      { id: "select-all", label: "Select All", shortcut: "❖A", enabled: hasNote || hasDeleted },
      { type: "separator" },
      { id: "find", label: "Find…", shortcut: "❖F" },
      { id: "find:next", label: "Find Next", shortcut: "❖G", enabled: context.hasMatches },
      { id: "find:previous", label: "Find Previous", shortcut: "⇧❖G", enabled: context.hasMatches },
    ],
  };
}

function formatMenu({ hasNote }: MenuContext): MenuSpec {
  return {
    id: "format",
    title: "Format",
    items: FORMATS.map((row) =>
      row === null
        ? { type: "separator" as const }
        : { id: `format:${row.command}`, label: row.label, ...(row.shortcut ? { shortcut: row.shortcut } : {}), enabled: hasNote },
    ),
  };
}

function noteMenu(context: MenuContext): MenuSpec {
  const { hasNote } = context;
  return {
    id: "note",
    title: "Note",
    items: [
      { id: "note:pin", label: context.pinned ? "Unpin Note" : "Pin Note", enabled: hasNote },
      { type: "separator" },
      ...placesOf(context.folders).map((place, index) => ({
        id: `move:${index}`,
        label: `Move to ${place === "" ? DEFAULT_FOLDER_NAME : place}`,
        enabled: hasNote,
        checked: hasNote ? place === context.noteFolder : false,
      })),
    ],
  };
}

function viewMenu({ source, folders }: MenuContext): MenuSpec {
  return {
    id: "view",
    items: [
      { id: "show:all", label: "All Notes", checked: source.kind === "all" },
      ...placesOf(folders).map((place, index) => ({
        id: `show:${index}`,
        label: place === "" ? DEFAULT_FOLDER_NAME : place,
        checked: source.kind === "folder" && source.name === place,
      })),
      { id: "show:trash", label: "Recently Deleted", checked: source.kind === "trash" },
    ],
  };
}

/** What choosing a row does. */
function choose(id: string, context: MenuContext): void {
  const { actions } = context;
  const openFolder = openFolderOf(context.source);
  const places = placesOf(context.folders);
  const index = /^(?:move|show):(\d+)$/.exec(id);
  const place = index ? places[Number(index[1])] : undefined;
  if (id.startsWith("move:") && place !== undefined) return actions.moveTo(place);
  if (id.startsWith("show:") && place !== undefined) return actions.show({ kind: "folder", name: place });
  const command = FORMATS.find((row) => row !== null && id === `format:${row.command}`);
  if (command) return actions.format(command.command);
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
    case "show:all":
      return actions.show({ kind: "all" });
    case "show:trash":
      return actions.show({ kind: "trash" });
    case "undo":
      return actions.undo();
    case "redo":
      return actions.redo();
    case "cut":
      return actions.cut();
    case "copy":
      return actions.copy();
    case "paste":
      return actions.paste();
    case "select-all":
      return actions.selectAll();
    case "find":
      return actions.find();
    case "find:next":
      return actions.findNext(1);
    case "find:previous":
      return actions.findNext(-1);
  }
}

/** The menus, and what choosing each row does (only an enabled row runs). */
export function notesMenus(context: MenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const menus = [fileMenu(context), editMenu(context), formatMenu(context), noteMenu(context), viewMenu(context)];
  const run = (id: string): void => {
    if (enabledIds(menus).has(id)) choose(id, context);
  };
  return { menus, run };
}
