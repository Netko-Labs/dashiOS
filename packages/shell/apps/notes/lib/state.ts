/**
 * What the notes model holds, and the names the window and the other files
 * use for it.
 */

import { serializeNote } from "../../../src/shared/notes/text.ts";
import type { DeletedNote, Note } from "../../../src/shared/notes/types.ts";
import type { Selection } from "./format.ts";
import type { Source } from "./list.ts";

export const SAVE_MS = 600;

/** A step of typing, as Undo puts it back: the text and where the caret was. */
export interface TextState {
  draft: Draft;
  selection: Selection;
}

export interface Draft {
  title: string;
  body: string;
}

export interface NotesState {
  notes: Note[];
  folders: string[];
  deleted: DeletedNote[];
  source: Source;
  query: string;
  /** A note id (or, in Recently Deleted, a file name). */
  selected: string | null;
  draft: Draft | null;
  /** The body's caret and selection (offsets into `draft.body`). */
  selection: Selection;
  /** Changes whenever the editor's fields must start over (another note opened, a file changed under it). */
  session: number;
  /** The title field asks for the keyboard (a new note). */
  focusTitle: boolean;
  /** The last thing that went wrong, for a line in the window. */
  error: string | null;
  /** Something the person should know that isn't an error (a conflict copy was saved); cleared when another note opens. */
  notice: string | null;
}

export const fingerprint = (draft: Draft): string => serializeNote({ ...draft, heading: false });
