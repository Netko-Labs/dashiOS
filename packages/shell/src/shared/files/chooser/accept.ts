/**
 * What pressing Open or Save means, from where the chooser stands: the files
 * picked, a folder to go into, a name to fix, or a file that would be
 * replaced (asked first). Pure, so every case is a test.
 */

import { join } from "node:path";
import { nameProblem, untakenName } from "./filters.ts";
import type { ChooserRequest } from "./request.ts";

export interface Picked {
  path: string;
  folder: boolean;
}

export interface Standing {
  /** The folder shown, or null for Recents and search. */
  folder: string | null;
  /** Where a save goes when no folder is shown (the one asked for, else Documents or home). */
  saveFolder: string;
  selected: readonly Picked[];
  /** The name typed (SaveFile). */
  name: string;
  /** The person already said Replace for this path. */
  replacing: string | null;
}

export type Outcome =
  | { kind: "done"; paths: string[] }
  | { kind: "open-folder"; path: string }
  | { kind: "replace"; path: string }
  | { kind: "problem"; text: string }
  | { kind: "nothing" };

export function accept(request: ChooserRequest, standing: Standing, exists: (path: string) => boolean): Outcome {
  const { selected } = standing;
  if (request.mode === "open") {
    if (request.directory) {
      const folders = selected.filter((item) => item.folder).map((item) => item.path);
      if (folders.length > 0) return { kind: "done", paths: request.multiple ? folders : folders.slice(0, 1) };
      return standing.folder ? { kind: "done", paths: [standing.folder] } : { kind: "nothing" };
    }
    const files = selected.filter((item) => !item.folder).map((item) => item.path);
    if (files.length > 0) return { kind: "done", paths: request.multiple ? files : files.slice(0, 1) };
    const folder = selected.find((item) => item.folder);
    return folder ? { kind: "open-folder", path: folder.path } : { kind: "nothing" };
  }
  // A folder picked while saving is gone into, as on a Mac.
  const into = selected.length === 1 && selected[0]?.folder ? selected[0].path : null;
  if (into && into !== standing.folder) return { kind: "open-folder", path: into };
  const folder = standing.folder ?? standing.saveFolder;
  if (request.mode === "save-files") {
    const used = new Set<string>();
    const paths = request.files.map((name) => {
      const free = untakenName(name, (candidate) => used.has(candidate) || exists(join(folder, candidate)));
      used.add(free);
      return join(folder, free);
    });
    return paths.length > 0 ? { kind: "done", paths } : { kind: "done", paths: [folder] };
  }
  const name = standing.name.trim();
  const problem = nameProblem(name);
  if (problem) return { kind: "problem", text: problem };
  const path = join(folder, name);
  if (exists(path) && standing.replacing !== path) return { kind: "replace", path };
  return { kind: "done", paths: [path] };
}

/** Where a save starts: the file being saved again's folder, the folder asked for, else Documents, else home. */
export function startFolder(request: ChooserRequest, documents: string | null, home: string): string {
  if (request.currentFile) {
    const slash = request.currentFile.lastIndexOf("/");
    if (slash > 0) return request.currentFile.slice(0, slash);
  }
  return request.currentFolder ?? documents ?? home;
}

/** The name a save starts with: the one suggested, else the file's own, else empty. */
export function startName(request: ChooserRequest): string {
  if (request.currentName) return request.currentName;
  if (request.currentFile) return request.currentFile.split("/").pop() ?? "";
  return "";
}
