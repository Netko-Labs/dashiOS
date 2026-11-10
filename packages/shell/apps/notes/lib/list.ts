/** What the note list shows for a source (All Notes, a folder, Recently Deleted) and a search. */

import { type DeletedNote, listOrder, type Note, searchNotes } from "../../../src/shared/notes/index.ts";

export type Source = { kind: "all" } | { kind: "folder"; name: string } | { kind: "trash" };

/** One row of the list: a note, or a deleted one. */
export interface Row {
  id: string;
  title: string;
  body: string;
  modified: number;
  pinned: boolean;
  /** "" is the default folder. */
  folder: string;
  deleted: boolean;
  /** For a deleted note: when it was deleted. */
  deletedAt: number;
}

const live = (note: Note): Row => ({
  id: note.id,
  title: note.title,
  body: note.body,
  modified: note.modified,
  pinned: note.pinned,
  folder: note.folder,
  deleted: false,
  deletedAt: 0,
});
const gone = (note: DeletedNote): Row => ({
  id: note.id,
  title: note.title,
  body: note.body,
  modified: note.modified,
  pinned: false,
  folder: "",
  deleted: true,
  deletedAt: note.deletedAt,
});

/**
 * The rows to show. A search looks at every note, wherever the sidebar is
 * (Recently Deleted is searched only when it is the open source).
 */
export function visibleRows(notes: readonly Note[], deleted: readonly DeletedNote[], source: Source, query: string): Row[] {
  if (source.kind === "trash") {
    const rows = deleted.map(gone);
    return query.trim() === "" ? rows : searchNotes(rows, query);
  }
  const all = notes.map(live);
  if (query.trim() !== "") return searchNotes(all, query);
  const here = source.kind === "folder" ? all.filter((row) => row.folder === source.name) : all;
  return listOrder(here);
}

/** The id to select after `id` leaves the list: the next row, else the one before. */
export function neighbor(rows: readonly Row[], id: string | null): string | null {
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return rows[0]?.id ?? null;
  return (rows[at + 1] ?? rows[at - 1])?.id ?? null;
}

/** The row `step` away from `id` (-1 up, 1 down), staying in the list. */
export function step(rows: readonly Row[], id: string | null, by: -1 | 1): string | null {
  if (rows.length === 0) return null;
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return rows[by === 1 ? 0 : rows.length - 1]?.id ?? null;
  return rows[Math.min(rows.length - 1, Math.max(0, at + by))]?.id ?? null;
}

/** The rows with the open note's row showing what is typed in it (its title and first line), before it is saved. */
export function withDraft(rows: readonly Row[], id: string | null, draft: { title: string; body: string } | null): Row[] {
  if (!draft || id === null) return [...rows];
  return rows.map((row) => (row.id === id && !row.deleted ? { ...row, title: draft.title, body: draft.body } : row));
}
