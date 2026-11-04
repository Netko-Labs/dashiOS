/** What the store hands the app (and the agents). */

export interface Note {
  /** "Folder/Title.md", or "Title.md" in the default folder: the path under the notes root. */
  id: string;
  /** "" is the default folder (the notes directly in the root). */
  folder: string;
  title: string;
  body: string;
  /** The first line is written as "# Title". */
  heading: boolean;
  /** Last modified, ms since the epoch. */
  modified: number;
  created: number;
  pinned: boolean;
}

export interface DeletedNote {
  /** The file name inside Recently Deleted. */
  id: string;
  title: string;
  body: string;
  heading: boolean;
  modified: number;
  /** The id it had, so it can go back. */
  from: string;
  deletedAt: number;
}

export interface Snapshot {
  notes: Note[];
  /** Folder names, sorted; without the default folder. */
  folders: string[];
  deleted: DeletedNote[];
}

/** Why the store refused something the person or an agent asked for. */
export class NotesError extends Error {}
