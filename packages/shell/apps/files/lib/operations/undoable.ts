/**
 * What Files can take back (design.html PA-2): each write it did, as an
 * action for @dashi/ui's undo stack, named for Edit › Undo ("Undo Rename").
 * Rename goes back to the old name; a new folder goes (removed when empty,
 * else moved to the Trash); Move to Trash puts back from the home Trash; a
 * move moves back; a copy or duplicate goes to the Trash; what a Replace
 * sent to the Trash comes back after (PA-3). Redo does each again. Where an
 * item went in the Trash is kept, so a replaced file and its replacement,
 * both from one path, are never mixed up. The paths an action works on follow it: a name taken meanwhile
 * makes a free one, and the next step goes from there.
 */

import { readdir, readFile, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { UndoAction } from "@dashi/ui";
import {
  baseName,
  type Exec,
  findTrashed,
  makeFolder,
  moveInto,
  OpError,
  parentOf,
  parseTrashInfo,
  putBack,
  quietContext,
  renamePath,
  type TrashPlaces,
  trashPaths,
} from "../../../../src/shared/files/index.ts";

export interface UndoEnv {
  trash: TrashPlaces;
  home: string;
  run: Exec;
  /** After a step: reload the listing and select these paths where they are shown. */
  refresh(select: readonly string[]): void;
}

const quote = (path: string): string => `“${baseName(path)}”`;

/** Where each original went in the Trash, when known: two items from one path (a replaced file and its replacement) are told apart by it. */
type Spots = ReadonlyMap<string, string>;

const trashNames = (env: UndoEnv): Promise<Set<string>> =>
  readdir(env.trash.files).then(
    (names) => new Set(names),
    () => new Set<string>(),
  );

/** Moves `paths` to the Trash; where each landed in the home Trash (the entries new since). */
async function toTrash(paths: readonly string[], env: UndoEnv): Promise<Spots> {
  const before = await trashNames(env);
  const result = await trashPaths(paths, quietContext(), env.run);
  const first = result.failed[0];
  if (first) throw new OpError(`${quote(first.path)} couldn’t be moved to the Trash: ${first.reason}`);
  const spots = new Map<string, string>();
  for (const name of await trashNames(env)) {
    if (before.has(name)) continue;
    const info = await readFile(join(env.trash.info, `${name}.trashinfo`), "utf8").then(parseTrashInfo, () => null);
    if (info && paths.includes(info.originalPath)) spots.set(info.originalPath, join(env.trash.files, name));
  }
  return spots;
}

/** Puts `paths` back from the Trash: from the spot each went to when known, else the newest with its path. */
async function fromTrash(paths: readonly string[], env: UndoEnv, spots: Spots = new Map()): Promise<string[]> {
  const back: string[] = [];
  for (const path of paths) {
    const trashed = spots.get(path) ?? (await findTrashed(path, env.trash));
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
  let spots: Spots = new Map();
  return {
    name: "Move to Trash",
    async undo() {
      originals = await fromTrash(originals, env, spots);
      env.refresh(originals);
    },
    async do() {
      spots = await toTrash(originals, env);
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

/**
 * `action`, which took the names of `replaced` (moved to the Trash first:
 * Replace, PA-3). Undo takes the action back, then puts them back where
 * they were; Redo sends them to the Trash again before doing it again.
 */
export function withReplaced(action: UndoAction, replaced: readonly string[], env: UndoEnv): UndoAction {
  if (replaced.length === 0) return action;
  let gone = [...replaced];
  let spots: Spots = new Map();
  return {
    name: action.name,
    async undo() {
      // Found before the action's own undo sends the newcomer to the Trash under the same original path.
      const found = new Map<string, string>();
      for (const path of gone) {
        const spot = spots.get(path) ?? (await findTrashed(path, env.trash));
        if (spot) found.set(path, spot);
      }
      await action.undo();
      gone = await fromTrash(gone, env, found);
      env.refresh(gone);
    },
    async do() {
      spots = await toTrash(gone, env);
      await action.do();
    },
  };
}

/** `created` were made as copies (Copy, Paste, Duplicate, Compress): Undo moves them to the Trash. */
export function copyAction(name: string, created: readonly string[], env: UndoEnv): UndoAction {
  let paths = [...created];
  let spots: Spots = new Map();
  return {
    name,
    async undo() {
      spots = await toTrash(paths, env);
      env.refresh([]);
    },
    async do() {
      paths = await fromTrash(paths, env, spots);
      env.refresh(paths);
    },
  };
}
