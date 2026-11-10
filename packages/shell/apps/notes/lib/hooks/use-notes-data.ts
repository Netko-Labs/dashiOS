/**
 * What the window draws from the model: its snapshot, the rows of the list
 * (the open note's following its typing), the counts the sidebar shows, the
 * title and the word count, and the clock the list's dates are told by.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DEFAULT_FOLDER_NAME } from "../../../../src/shared/notes/names.ts";
import { wordCount } from "../../../../src/shared/notes/text.ts";
import { findMatches } from "../find.ts";
import { type Row, withDraft } from "../list.ts";
import type { NotesModel } from "../model.ts";
import type { NotesState } from "../state.ts";

export const folderLabel = (folder: string): string => (folder === "" ? DEFAULT_FOLDER_NAME : folder);

export interface NotesData {
  state: NotesState;
  rows: Row[];
  /** The open note's row. */
  row: Row | null;
  /** The open note itself (the row has only what the list shows). */
  openNote: NotesState["notes"][number] | undefined;
  inTrash: boolean;
  searchingNow: boolean;
  counts: { all: number; deleted: number; byFolder: Map<string, number> };
  hasMatches: boolean;
  title: string;
  words: number;
  now: number;
}

export function useNotesData(model: NotesModel): NotesData {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the model is mutable; these say when its rows changed
  const listed = useMemo(() => model.rows(), [model, state.notes, state.deleted, state.source, state.query]);
  // The open note's row follows its typing at once, not only once it is saved or left.
  const rows = useMemo(() => withDraft(listed, state.selected, state.draft), [listed, state.selected, state.draft]);
  const row = rows.find((each) => each.id === state.selected) ?? null;
  const inTrash = state.source.kind === "trash";
  const searchingNow = state.query.trim() !== "";
  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const note of state.notes) byFolder.set(note.folder, (byFolder.get(note.folder) ?? 0) + 1);
    return { all: state.notes.length, deleted: state.deleted.length, byFolder };
  }, [state.notes, state.deleted]);
  const hasMatches = useMemo(() => state.draft !== null && findMatches(state.draft.body, state.query).length > 0, [state.draft, state.query]);
  const title = inTrash ? "Recently Deleted" : searchingNow ? "Search Results" : state.source.kind === "folder" ? folderLabel(state.source.name) : "All Notes";
  const words = state.draft ? wordCount(`${state.draft.title} ${state.draft.body}`) : row ? wordCount(`${row.title} ${row.body}`) : 0;
  const openNote = state.notes.find((each) => each.id === row?.id);
  return { state, rows, row, openNote, inTrash, searchingNow, counts, hasMatches, title, words, now };
}
