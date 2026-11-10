/**
 * What went wrong, in a sentence the person can act on (design.html PA-6):
 * a system error's code (EACCES, ENOSPC) never reaches the window, and the
 * store's own refusals, written for agents with a note's id in them, become
 * what the person sees instead. Pure.
 */

import { NotesError } from "../../../src/shared/notes/types.ts";

/** What Notes was doing when it failed. */
export type Doing = "save" | "create" | "read" | "change";

const WHAT: Readonly<Record<Doing, string>> = {
  save: "Notes couldn't save this note.",
  create: "Notes couldn't make a new note.",
  read: "Notes couldn't read your notes folder.",
  change: "Notes couldn't do that.",
};

/** The system's code for an error (EACCES), if it has one. */
function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : null;
}

/** `error`, met while `doing`, as one or two plain sentences. */
export function plainError(error: unknown, doing: Doing): string {
  const what = WHAT[doing];
  if (error instanceof NotesError) {
    if (/folder/.test(error.message)) return `${what} That folder isn't there any more.`;
    return `${what} That note isn't there any more.`;
  }
  switch (codeOf(error)) {
    case "EACCES":
    case "EPERM":
      return `${what} It isn't allowed to write in the Notes folder in Documents.`;
    case "EROFS":
      return `${what} The Notes folder is on a disk that can only be read.`;
    case "ENOSPC":
    case "EDQUOT":
      return `${what} The disk is full.`;
    case "ENOENT":
      return `${what} It isn't there any more.`;
    case "EEXIST":
      return `${what} Something with that name is already there.`;
    case "ENAMETOOLONG":
      return `${what} The name is too long.`;
    default:
      return what;
  }
}
