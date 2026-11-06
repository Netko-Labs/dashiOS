/**
 * What Files can take back (design.html PA-2): each write it did, as an
 * action for @dashi/ui's undo stack, named for Edit › Undo ("Undo Rename").
 * Rename goes back to the old name; a new folder goes (removed when empty,
 * else moved to the Trash); Move to Trash puts back from the home Trash; a
 * move moves back; a copy or duplicate goes to the Trash. Redo does each
 * again. The paths an action works on follow it: a name taken meanwhile
 * makes a free one, and the next step goes from there.
 */

import { rmdir } from "node:fs/promises";
import type { UndoAction } from "@dashi/ui";
import type { Exec } from "./exec.ts";
import { makeFolder, moveInto, OpError, quietContext, renamePath } from "./ops.ts";
import { baseName, parentOf } from "./paths.ts";
import { findTrashed, putBack, type TrashPlaces, trashPaths } from "./trashops.ts";

export interface UndoEnv {
  trash: TrashPlaces;
  home: string;
  run: Exec;
  /** After a step: reload the listing and select these paths where they are shown. */
  refresh(select: readonly string[]): void;
}

const quote = (path: string): string => `“${baseName(path)}”`;

async function toTrash(paths: readonly string[], env: UndoEnv): Promise<void> {
  const result = await trashPaths(paths, quietContext(), env.run);
  const first = result.failed[0];
  if (first) throw new OpError(`${quote(first.path)} couldn’t be moved to the Trash: ${first.reason}`);
}

async function fromTrash(paths: readonly string[], env: UndoEnv): Promise<string[]> {
  const back: string[] = [];
  for (const path of paths) {
    const trashed = await findTrashed(path, env.trash);
    if (!trashed) throw new OpError(`${quote(path)} isn’t in the Trash any more.`);
    back.push(await putBack(trashed, env.trash, env.home));
  }
  return back;
}

/** `from` was renamed to `to`. */
export function renameAction(from: string, to: string, env: UndoEnv): UndoAction {
  let before = from;
  let after = to;
  return {
    name: "Rename",
    async undo() {
      before = await renamePath(after, baseName(before));
      env.refresh([before]);
    },
    async do() {
      after = await renamePath(before, baseName(after));
      env.refresh([after]);
    },
  };
}

/** The folder `path` was made. */
export function newFolderAction(path: string, env: UndoEnv): UndoAction {
  return {
    name: "New Folder",
    async undo() {
      // Empty, it just goes; with something put in it since, to the Trash.
      await rmdir(path).catch(() => toTrash([path], env));
      env.refresh([]);
    },
    async do() {
      await makeFolder(parentOf(path), baseName(path));
      env.refresh([path]);
    },
  };
}

/** `paths` were moved to the Trash. */
export function trashAction(paths: readonly string[], env: UndoEnv): UndoAction {
  let originals = [...paths];
  return {
    name: "Move to Trash",
    async undo() {
      originals = await fromTrash(originals, env);
      env.refresh(originals);
    },
    async do() {
      await toTrash(originals, env);
      env.refresh([]);
    },
  };
}

/** Each `from` was moved to its `to` (a drop, or a paste after Cut). */
export function moveAction(moves: ReadonlyArray<{ from: string; to: string }>, env: UndoEnv): UndoAction {
  let pairs = moves.map((move) => ({ ...move }));
  return {
    name: "Move",
    async undo() {
      const next = [];
      for (const pair of [...pairs].reverse()) {
        const back = await moveInto(pair.to, parentOf(pair.from), quietContext(), baseName(pair.from));
        next.unshift({ from: back ?? pair.from, to: pair.to });
      }
      pairs = next;
      env.refresh(pairs.map((pair) => pair.from));
    },
    async do() {
      const next = [];
      for (const pair of pairs) {
        const moved = await moveInto(pair.from, parentOf(pair.to), quietContext(), baseName(pair.to));
        next.push({ from: pair.from, to: moved ?? pair.to });
      }
      pairs = next;
      env.refresh(pairs.map((pair) => pair.to));
    },
  };
}

/** `created` were made as copies (Copy, Paste, Duplicate, Compress): Undo moves them to the Trash. */
export function copyAction(name: string, created: readonly string[], env: UndoEnv): UndoAction {
  let paths = [...created];
  return {
    name,
    async undo() {
      await toTrash(paths, env);
      env.refresh([]);
    },
    async do() {
      paths = await fromTrash(paths, env);
      env.refresh(paths);
    },
  };
}
