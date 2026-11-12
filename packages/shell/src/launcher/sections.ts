/**
 * The launcher's sections (rows.ts builds them) and the files section among
 * them: where file rows stand for the query being shown (none, off, waiting
 * in held slots, found), and the section each state draws.
 */

import { INFO } from "@dashi/ui";
import { MIN_QUERY } from "../shared/files/index.ts";
import { answerFor } from "./lib/answers/index.ts";
import { type FileRow, fileNameMatches, fileRow, type Row } from "./row-model.ts";

/** File rows drawn below the instant rows. */
export const FILE_ROWS = 3;

export interface Section {
  id: string;
  title?: string;
  /** Muted words at the head's right end. */
  aside?: string;
  rows: Row[];
  /** Blank slots held for rows still coming (files): drawn empty, never selected. */
  reserved?: number;
  /** Draw this many rows at once, scrolled with the selection (a scope's long list: scope.ts; All apps). */
  window?: number;
}

/** Where file rows stand for the query being shown. */
export type FilesState =
  /** Not asked: file search isn't offered here, the query is short, or it is a sum. */
  | { kind: "none" }
  /** File search is off (no LocalSearch). */
  | { kind: "off" }
  /** Asked; the answer hasn't come. `reserved` slots are held for it. */
  | { kind: "waiting"; reserved: number }
  | { kind: "found"; files: readonly FileRow[] };

/**
 * Where file rows stand: none for a short query or a sum (pure math never
 * asks), off when file search is, found when the last answer is for this
 * query, else waiting with as many slots held as the last answer filled.
 */
export function filesStateFor(state: {
  query: string;
  /** File search is offered here at all. */
  offered: boolean;
  /** It said it is off (no LocalSearch). */
  off: boolean;
  /** The last answer, null files meaning it could not look. */
  answer: { query: string; files: readonly FileRow[] | null } | null;
  /** Rows the last answer filled. */
  lastCount: number;
}): FilesState {
  const query = state.query.trim();
  if (!state.offered || query.length < MIN_QUERY || answerFor(query) !== null) return { kind: "none" };
  if (state.off) return { kind: "off" };
  if (state.answer?.query !== query) return { kind: "waiting", reserved: Math.min(state.lastCount, FILE_ROWS) };
  // Only names that answer the words as a name would (row-model.ts `fileNameMatches`): LocalSearch matches inside words.
  return state.answer.files === null ? { kind: "off" } : { kind: "found", files: state.answer.files.filter((file) => fileNameMatches(file.name, query)) };
}

export function filesSection(state: FilesState, query: string, most = FILE_ROWS): Section | null {
  switch (state.kind) {
    case "found":
      return state.files.length > 0 ? { id: "files", title: "Files", rows: state.files.slice(0, most).map(fileRow) } : null;
    case "waiting":
      return state.reserved > 0 ? { id: "files", title: "Files", rows: [], reserved: Math.min(state.reserved, most) } : null;
    case "off":
      return {
        id: "files",
        title: "Files",
        rows: [
          {
            id: "files-off",
            title: "File search is off",
            detail: "look in Files instead",
            kind: "",
            icon: { glyph: INFO },
            action: { kind: "search-files", query },
          },
        ],
      };
    case "none":
      return null;
  }
}
