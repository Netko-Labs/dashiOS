/**
 * Notes' window: folders on the left (with their counts), the list of notes,
 * the note itself as one live page (its date and word count above it), and a
 * toolbar with the actions; an error or a conflict copy floats as a notice.
 * Every command is in the menu bar (menus.ts), with its ❖ chord. The keyboard
 * is the open field's while one is focused; otherwise it is the kit's
 * KeySink: N new note, Backspace delete (Edit › Undo brings it back), P pin,
 * Enter writes in the note, / or F search, and the up and down arrows move
 * through the list. Esc in a field gives the keyboard back to the list.
 */

import { AppWindow, KeySink, type MenuItem, Notice, PopupMenu, SearchField, ToolbarButton, useUndo } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAppMenus } from "../kit/index.ts";
import { Editor } from "./editor.tsx";
import { findMatches } from "./find.ts";
import type { FormatCommand } from "./formats.ts";
import { CHECKLIST, COMPOSE, FOLDER_MOVE, PIN, PIN_FILLED, RESTORE, TRASH } from "./glyphs.ts";
import type { Row } from "./list.ts";
import { notesMenus } from "./menus.ts";
import type { NotesModel } from "./model.ts";
import { DEFAULT_FOLDER_NAME } from "./names.ts";
import { NoteList } from "./rows.tsx";
import { NotesSheet, type SheetState } from "./sheets.tsx";
import { Sidebar } from "./sidebar.tsx";
import { noteCount, wordCount } from "./text.ts";

export const NOTES_SIZE = { width: 980, height: 640 } as const;

type Menu = { x: number; y: number; items: MenuItem[] };

/** What the window needs from the app around it. */
export interface NotesHost {
  /** Scrolls the view with `testID` by `dy`. */
  scroll(testID: string, dy: number): void;
  /** Sends a key to the field with the keyboard ("ctrl-c"): Edit's Cut, Copy, Paste and Select All. */
  press(keystroke: string): void;
  /** Opens a link from a note (❖-click). */
  openLink(url: string): void;
}

const folderLabel = (folder: string): string => (folder === "" ? DEFAULT_FOLDER_NAME : folder);
const formatEdited = (time: number): string => new Date(time).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });

export function NotesWindow({ model, host }: { model: NotesModel; host: NotesHost }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // Bumped to take the keyboard back to the KeySink, or hand it to the search field.
  const [keys, setKeys] = useState(0);
  const [searching, setSearching] = useState(0);
  const [bodyFocus, setBodyFocus] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the model is mutable; these say when its rows changed
  const rows = useMemo(() => model.rows(), [model, state.notes, state.deleted, state.source, state.query]);
  const row = rows.find((each) => each.id === state.selected) ?? null;
  const inTrash = state.source.kind === "trash";
  const searchingNow = state.query.trim() !== "";
  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const note of state.notes) byFolder.set(note.folder, (byFolder.get(note.folder) ?? 0) + 1);
    return { all: state.notes.length, deleted: state.deleted.length, byFolder };
  }, [state.notes, state.deleted]);
  const hasMatches = useMemo(() => state.draft !== null && findMatches(state.draft.body, state.query).length > 0, [state.draft, state.query]);

  const takeKeys = (): void => setKeys((n) => n + 1);
  const closeOverlay = (): void => {
    setSheet(null);
    setMenu(null);
    takeKeys();
  };
  const title = inTrash ? "Recently Deleted" : searchingNow ? "Search Results" : state.source.kind === "folder" ? folderLabel(state.source.name) : "All Notes";
  const words = state.draft ? wordCount(`${state.draft.title} ${state.draft.body}`) : row ? wordCount(`${row.title} ${row.body}`) : 0;

  const moveItems = (id: string | null, current: string): MenuItem[] =>
    [{ name: "", label: DEFAULT_FOLDER_NAME }, ...state.folders.map((name) => ({ name, label: name }))].map((folder) => ({
      label: `Move to ${folder.label}`,
      checked: folder.name === current,
      onPress: () => model.moveTo(folder.name, id),
    }));

  // A format command acts on the note and hands it the keyboard, the caret where the command left it.
  const format = (command: FormatCommand): void => {
    if (!state.draft || inTrash) return;
    model.format(command);
    setBodyFocus((n) => n + 1);
  };

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

  const openNote = state.notes.find((each) => each.id === row?.id);
  // Edit › Undo and Redo: the typing first, then a deleted note (model.undoState); both stacks are watched.
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
    hasMatches,
    undo: model.undoState(),
    actions: {
      newNote: () => model.newNote(),
      newFolder: () => setSheet({ kind: "new-folder" }),
      renameFolder: (name) => setSheet({ kind: "rename-folder", name }),
      deleteFolder: (name) => setSheet({ kind: "delete-folder", name, count: state.notes.filter((note) => note.folder === name).length }),
      deleteNote: () => model.trashSelected(),
      restore: () => model.restoreSelected(),
      purge: () => row && setSheet({ kind: "purge", title: row.title }),
      emptyTrash: () => setSheet({ kind: "empty-trash", count: state.deleted.length }),
      pin: () => model.togglePin(),
      moveTo: (folder) => model.moveTo(folder),
      format,
      show: (source) => model.setSource(source),
      undo: () => void model.undoStep("undo"),
      redo: () => void model.undoStep("redo"),
      cut: () => host.press("ctrl-x"),
      copy: () => host.press("ctrl-c"),
      paste: () => host.press("ctrl-v"),
      selectAll: () => host.press("ctrl-a"),
      find: () => setSearching((n) => n + 1),
      findNext: (step) => {
        if (model.findNext(step)) setBodyFocus((n) => n + 1);
      },
    },
  });
  // The menu bar (src/app-menus/): every command, with its ❖ chord.
  useAppMenus(menus, run);

  const search = (
    <SearchField
      key={`search:${searching}`}
      testID="search"
      value={state.query}
      onChangeText={(q) => model.setQuery(q)}
      width={170}
      autoFocus={searching > 0}
      onKeyPress={(key) => (key === "Escape" ? takeKeys() : model.moveSelection(key === "ArrowUp" ? -1 : 1))}
    />
  );
  const toolbar = inTrash ? (
    <>
      <ToolbarButton testID="restore" glyph={RESTORE} label="Restore" disabled={!row} onPress={() => model.restoreSelected()} />
      <ToolbarButton testID="purge" glyph={TRASH} label="Delete" disabled={!row} onPress={() => row && setSheet({ kind: "purge", title: row.title })} />
      <ToolbarButton
        testID="empty-trash"
        glyph={TRASH}
        label="Delete All"
        disabled={state.deleted.length === 0}
        onPress={() => setSheet({ kind: "empty-trash", count: state.deleted.length })}
      />
      <View style={{ width: 8 }} />
      {search}
    </>
  ) : (
    <>
      <ToolbarButton testID="new-note" glyph={COMPOSE} tooltip="New note" onPress={() => model.newNote()} />
      <ToolbarButton testID="delete" glyph={TRASH} tooltip="Delete note" disabled={!row} onPress={() => model.trashSelected()} />
      <ToolbarButton
        testID="pin"
        glyph={openNote?.pinned ? PIN_FILLED : PIN}
        tooltip={openNote?.pinned ? "Unpin note" : "Pin note"}
        disabled={!row}
        onPress={() => model.togglePin()}
      />
      <ToolbarButton
        testID="move"
        glyph={FOLDER_MOVE}
        tooltip="Move to a folder"
        disabled={!row}
        // The menu opens under the button that opened it (PA-9).
        onPress={(event) =>
          row && setMenu({ x: event.bounds?.x ?? 0, y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0) + 4, items: moveItems(row.id, row.folder) })
        }
      />
      <ToolbarButton testID="checklist" glyph={CHECKLIST} tooltip="Checklist" disabled={!row} onPress={() => format("checklist")} />
      <View style={{ width: 8 }} />
      {search}
    </>
  );

  const overlay = sheet ? (
    <NotesSheet
      sheet={sheet}
      onClose={closeOverlay}
      actions={{
        createFolder: (name) => {
          const made = model.createFolder(name);
          if (made !== null) model.setSource({ kind: "folder", name: made });
        },
        renameFolder: (from, to) => model.renameFolder(from, to),
        deleteFolder: (name) => model.deleteFolder(name),
        purge: () => model.purgeSelected(),
        emptyTrash: () => model.emptyTrash(),
      }}
    />
  ) : menu ? (
    <PopupMenu testID="menu" x={menu.x} y={menu.y} items={menu.items} onClose={closeOverlay} />
  ) : undefined;

  // One chrome row: the count follows the title on its line (and the sidebar's badges), the words follow the note's date, and an error or a conflict copy floats as a notice.
  return (
    <AppWindow
      title={title}
      detail={noteCount(rows.length)}
      toolbar={toolbar}
      overlay={overlay}
      notice={
        state.error ? (
          <Notice testID="error" tone="error" text={state.error} />
        ) : state.notice ? (
          <Notice testID="conflict" text={state.notice} onDismiss={() => model.dismissNotice()} />
        ) : undefined
      }
      sidebar={
        <Sidebar
          folders={state.folders}
          counts={counts}
          source={state.source}
          onSource={(source) => {
            model.setSource(source);
            takeKeys();
          }}
          onNewFolder={() => setSheet({ kind: "new-folder" })}
          onFolderMenu={openFolderMenu}
        />
      }
    >
      {sheet === null && menu === null && (
        <KeySink
          focusKey={keys}
          onKey={(key) => {
            if (key.kind === "up" || key.kind === "down") return model.moveSelection(key.kind === "up" ? -1 : 1);
            if (key.kind === "backspace") return inTrash ? row && setSheet({ kind: "purge", title: row.title }) : model.trashSelected();
            if (key.kind === "enter") {
              if (row && !inTrash) setBodyFocus((n) => n + 1);
              return;
            }
            if (key.kind !== "text") return;
            const letter = key.text.toLowerCase();
            if (letter === "n" && !inTrash) model.newNote();
            else if (letter === "p" && !inTrash) model.togglePin();
            else if (letter === "/" || letter === "f") setSearching((n) => n + 1);
          }}
        />
      )}
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <NoteList
          rows={rows}
          selected={state.selected}
          onSelect={(id) => {
            model.select(id);
            takeKeys();
          }}
          onMenu={openRowMenu}
          showFolder={searchingNow || state.source.kind === "all"}
          folderLabel={folderLabel}
          now={now}
          emptyText={searchingNow ? "No matches" : inTrash ? "Nothing deleted" : "No notes yet"}
        />
        <Editor
          draft={state.draft}
          row={row}
          selection={state.selection}
          query={state.query}
          session={state.session}
          focusTitle={state.focusTitle}
          onEdit={(change) => model.edit(change)}
          onSelection={(selection) => model.setSelection(selection)}
          onToggleCheck={(line) => model.toggleCheck(line)}
          onOpenLink={host.openLink}
          onLeave={takeKeys}
          follow={() => host.scroll("editor", 1_000_000)}
          onRestore={() => model.restoreSelected()}
          onNew={() => model.newNote()}
          bodyFocus={bodyFocus}
          onFocusBody={() => setBodyFocus((n) => n + 1)}
          empty={
            searchingNow
              ? { title: "No matches", message: "Nothing matches your search.", canCreate: false }
              : inTrash
                ? { title: "Nothing deleted", message: "Deleted notes stay here for 30 days.", canCreate: false }
                : counts.all === 0
                  ? { title: "Write your first note", message: "Notes are Markdown files in Documents › Notes, yours to open anywhere.", canCreate: true }
                  : { title: "No notes here yet", message: "Make one, or move one here from the Note menu.", canCreate: true }
          }
          hasNotes={rows.length > 0}
          formatDate={formatEdited}
          words={words}
        />
      </View>
    </AppWindow>
  );
}
