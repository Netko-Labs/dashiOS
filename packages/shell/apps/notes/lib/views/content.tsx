/**
 * The notes window's body: the kit's key sink, the list of notes, and the
 * note itself as one live page with the notice about it floating at its foot.
 */

import { type KeyInput, KeySink, Notice } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import type { Focus } from "../hooks/use-focus.ts";
import type { NoteActions } from "../hooks/use-note-actions.ts";
import { folderLabel, type NotesData } from "../hooks/use-notes-data.ts";
import type { Overlays } from "../hooks/use-overlays.ts";
import { type DateForm, noticeWidth } from "../layout.ts";
import type { Source } from "../list.ts";
import type { NotesModel } from "../model.ts";
import { Editor } from "./editor.tsx";
import { NoteList } from "./rows.tsx";

const DATE_FORMS: Record<DateForm, Intl.DateTimeFormatOptions> = {
  long: { dateStyle: "long", timeStyle: "short" },
  medium: { dateStyle: "medium", timeStyle: "short" },
  short: { month: "short", day: "numeric" },
};
const formatEdited = (time: number, form: DateForm): string => new Date(time).toLocaleString(undefined, DATE_FORMS[form]);
const sourceKey = (source: Source): string => (source.kind === "folder" ? `folder:${source.name}` : source.kind);

/** What the window needs from the app around it. */
export interface NotesHost {
  /** Scrolls the view with `testID` by `dy`. */
  scroll(testID: string, dy: number): void;
  /** Sends a key to the field with the keyboard ("ctrl-c"): Edit's Cut, Copy, Paste and Select All. */
  press(keystroke: string): void;
  /** Opens a link from a note (❖-click). */
  openLink(url: string): void;
}

/** What the note's page says when there is no note to show. */
function emptyFor(data: NotesData): { title: string; message: string; canCreate: boolean } {
  if (data.searchingNow) return { title: "No matches", message: "Nothing matches your search.", canCreate: false };
  if (data.inTrash) return { title: "Nothing deleted", message: "Deleted notes stay here for 30 days.", canCreate: false };
  if (data.counts.all === 0)
    return { title: "Write your first note", message: "Notes are Markdown files in Documents › Notes, yours to open anywhere.", canCreate: true };
  return { title: "No notes here yet", message: "Make one, or move one here from the Note menu.", canCreate: true };
}

/** A key while the list has the keyboard: ↑↓ move, ⌫ deletes, Return goes to the note, and N, P, / and F are shortcuts. */
function listKey(key: KeyInput, { model, data, focus, setSheet }: { model: NotesModel; data: NotesData; focus: Focus; setSheet: Overlays["setSheet"] }): void {
  const { row, inTrash } = data;
  if (key.kind === "up" || key.kind === "down") return model.moveSelection(key.kind === "up" ? -1 : 1);
  if (key.kind === "backspace") {
    if (!inTrash) model.trashSelected();
    else if (row) setSheet({ kind: "purge", title: row.title });
    return;
  }
  if (key.kind === "enter") {
    if (row && !inTrash) focus.focusBody();
    return;
  }
  if (key.kind !== "text") return;
  const letter = key.text.toLowerCase();
  if (letter === "n" && !inTrash) model.newNote();
  else if (letter === "p" && !inTrash) model.togglePin();
  else if (letter === "/" || letter === "f") focus.search();
}

export function NotesContent({
  model,
  host,
  data,
  overlays,
  focus,
  actions,
  listWidth,
  windowWidth,
  notice,
}: {
  model: NotesModel;
  host: NotesHost;
  data: NotesData;
  overlays: Overlays;
  focus: Focus;
  actions: NoteActions;
  listWidth: number;
  windowWidth: number;
  notice: ReactElement | null;
}) {
  const { state, rows, row, inTrash, searchingNow, now } = data;
  const { sheet, menu, takeKeys, setSheet } = overlays;
  return (
    <>
      {sheet === null && menu === null && <KeySink focusKey={overlays.keys} onKey={(key) => listKey(key, { model, data, focus, setSheet })} />}
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <NoteList
          // A new source starts at the top of its list, where its first note, the one it opens, is.
          key={sourceKey(state.source)}
          width={listWidth}
          rows={rows}
          selected={state.selected}
          onSelect={(id) => {
            model.select(id);
            takeKeys();
          }}
          onMenu={actions.openRowMenu}
          showFolder={searchingNow || state.source.kind === "all"}
          folderLabel={folderLabel}
          now={now}
          emptyText={searchingNow ? "No matches" : inTrash ? "Nothing deleted" : "No notes yet"}
        />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", position: "relative" }}>
          <Editor
            now={now}
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
            onNew={() => model.newNote()}
            bodyFocus={focus.bodyFocus}
            empty={emptyFor(data)}
            hasNotes={rows.length > 0}
            formatDate={formatEdited}
            words={data.words}
          />
          {notice && (
            <View testID="note-notice" style={{ position: "absolute", left: 8, right: 8, bottom: 14, alignItems: "center" }}>
              <View style={{ width: noticeWidth(windowWidth), flexDirection: "column" }}>{notice}</View>
            </View>
          )}
        </View>
      </View>
    </>
  );
}

/** An error or a conflict copy is about the note: it floats at the foot of the note's column, clear of the list, and is dismissed by hand. */
export function noticeFor(model: NotesModel, data: NotesData): ReactElement | null {
  const { state } = data;
  if (state.error) return <Notice testID="error" tone="error" text={state.error} onDismiss={() => model.dismissError()} />;
  if (state.notice) return <Notice testID="conflict" text={state.notice} onDismiss={() => model.dismissNotice()} />;
  return null;
}
