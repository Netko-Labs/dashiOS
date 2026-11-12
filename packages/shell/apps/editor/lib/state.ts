/**
 * What the editor model holds, and the names the window uses for it.
 */

import type { Encoding, LineEnding } from "./codec.ts";
import type { EditorPrefs } from "./prefs.ts";
import type { VersionStore } from "./versions.ts";

export interface Notice {
  text: string;
  tone: "info" | "error";
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  /** Where each match starts. */
  matches: readonly number[];
  /** The match shown, -1 before one is. */
  current: number;
}

/** The file changed on disk while there were changes here (`changed`), or it isn't there any more (`gone`). */
export type Conflict = "changed" | "gone";

export interface EditorState {
  path: string | null;
  text: string;
  /** The text as it is in the file (as opened or last written). */
  saved: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  /** Bumped when another document comes into the window: the input starts over. */
  session: number;
  notice: Notice | null;
  conflict: Conflict | null;
  canUndo: boolean;
  canRedo: boolean;
  /** What Edit's Undo and Redo name ("Typing", "Replace All"), null when nothing. */
  undoName: string | null;
  redoName: string | null;
  prefs: EditorPrefs;
  find: FindState;
  /** The offset Find wants scrolled into view; `seq` changes with each jump. */
  reveal: { offset: number; seq: number } | null;
}

export type SaveResult = "saved" | "needs-path" | "conflict" | "failed";
export type AutosaveResult = "saved" | "clean" | "draft" | "conflict" | "failed";

export interface ModelOptions {
  /** View settings: where they are read from and written to. */
  loadPrefs?: () => EditorPrefs;
  savePrefs?: (prefs: EditorPrefs) => void;
  /** Where earlier versions are kept (main.tsx gives the person's); none without it. */
  versions?: VersionStore | null;
  now?: () => number;
}

export const isDirty = (state: EditorState): boolean => state.text !== state.saved;

export const NO_FIND: FindState = { query: "", caseSensitive: false, matches: [], current: -1 };
