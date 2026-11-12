/**
 * Notes' toolbar: New, Delete, Pin, Move and Checklist beside the search
 * field; in Recently Deleted, Restore and Delete instead (and Delete All, in
 * a window wide enough for it).
 */

import { SearchField, ToolbarButton } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { CHECKLIST, COMPOSE, FOLDER_MOVE, PIN, PIN_FILLED, RESTORE, TRASH } from "../glyphs.ts";
import type { Focus } from "../hooks/use-focus.ts";
import type { NoteActions } from "../hooks/use-note-actions.ts";
import type { NotesData } from "../hooks/use-notes-data.ts";
import type { Overlays } from "../hooks/use-overlays.ts";
import { SEARCH_MIN } from "../layout.ts";
import type { NotesModel } from "../model.ts";

function NotesSearch({ model, data, focus, takeKeys }: { model: NotesModel; data: NotesData; focus: Focus; takeKeys: () => void }) {
  return (
    <SearchField
      key={`search:${focus.searching}`}
      testID="search"
      value={data.state.query}
      onChangeText={(q) => model.setQuery(q)}
      width={170}
      minWidth={SEARCH_MIN}
      autoFocus={focus.searching > 0}
      // Find in the note: one Esc keeps the words and hands the keyboard to the note, on the match;
      // with none there, to the list.
      variant="find"
      onKeyPress={(key) => {
        if (key !== "Escape") model.moveSelection(key === "ArrowUp" ? -1 : 1);
        else if (model.findCurrent()) focus.focusBody();
        else takeKeys();
      }}
    />
  );
}

/** Recently Deleted's buttons: Restore, Delete, and Delete All while there is room. */
function TrashButtons({ model, data, setSheet, compact }: { model: NotesModel; data: NotesData; setSheet: Overlays["setSheet"]; compact: boolean }) {
  const { row, state } = data;
  return (
    <>
      {/* Narrow, the words go and Delete All leaves for File's "Delete All Recently Deleted…", so two trash glyphs never sit side by side. */}
      <ToolbarButton
        testID="restore"
        glyph={RESTORE}
        {...(compact ? { tooltip: "Restore" } : { label: "Restore" })}
        disabled={!row}
        onPress={() => model.restoreSelected()}
      />
      <ToolbarButton
        testID="purge"
        glyph={TRASH}
        {...(compact ? { tooltip: "Delete forever" } : { label: "Delete" })}
        disabled={!row}
        onPress={() => row && setSheet({ kind: "purge", title: row.title })}
      />
      {!compact && (
        <ToolbarButton
          testID="empty-trash"
          glyph={TRASH}
          label="Delete All"
          disabled={state.deleted.length === 0}
          onPress={() => setSheet({ kind: "empty-trash", count: state.deleted.length })}
        />
      )}
    </>
  );
}

export function NotesToolbar({
  model,
  data,
  overlays,
  focus,
  actions,
  compact,
}: {
  model: NotesModel;
  data: NotesData;
  overlays: Overlays;
  focus: Focus;
  actions: NoteActions;
  /** A narrow window: the toolbar's words go. */
  compact: boolean;
}) {
  const { row, openNote, inTrash } = data;
  const { setSheet, setMenu } = overlays;
  const search = <NotesSearch model={model} data={data} focus={focus} takeKeys={overlays.takeKeys} />;
  if (inTrash) {
    return (
      <>
        <TrashButtons model={model} data={data} setSheet={setSheet} compact={compact} />
        <View style={{ width: 8 }} />
        {search}
      </>
    );
  }
  return (
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
        // The menu hangs under the button that opened it, its right edge on the button's (PA-9).
        onPress={(event) =>
          row &&
          setMenu({
            x: (event.bounds?.x ?? 0) + (event.bounds?.width ?? 0),
            y: (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0) + 4,
            anchor: "end",
            items: actions.moveItems(row.id, row.folder),
          })
        }
      />
      <ToolbarButton testID="checklist" glyph={CHECKLIST} tooltip="Checklist" disabled={!row} onPress={() => actions.format("checklist")} />
      <View style={{ width: 8 }} />
      {search}
    </>
  );
}
