/**
 * A folder's contents as Files shows them: one `FileItem` per entry, read
 * with `lstat` (a symlink is a link, and also what it points at, for display)
 * and typed by name, or by its first bytes when the name says nothing
 * (sniff.ts: a log called `install.err` is text). Nothing here follows a link out of the way it is
 * asked to: a listing reads one directory, never recurses.
 */

import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { categoryOf, INODE_DIRECTORY, kindOf, type MimeIndex, mimeOf, UNKNOWN_TYPE } from "./mime.ts";
import { checkName, splitName } from "./paths.ts";
import { SNIFF_LIMIT, sniffType } from "./sniff.ts";

export type ItemKind = "file" | "folder" | "other";

export interface FileItem {
  name: string;
  path: string;
  kind: ItemKind;
  /** The entry itself is a symbolic link. */
  isLink: boolean;
  /** A symbolic link whose target is gone. */
  broken: boolean;
  /** Bytes (0 for a folder: its size is worked out on request). */
  size: number;
  /** Modification time, milliseconds. */
  mtime: number;
  /** `st_mode`. */
  mode: number;
  hidden: boolean;
  mime: string;
  /** The folder it is in, when a list mixes folders (search, Recents). */
  where?: string;
  /** Trash: where it was, and when it was trashed. */
  original?: string;
  deleted?: number;
}

/** What to call the item's kind ("Folder", "PNG image", "TXT file"). */
export function kindText(item: Pick<FileItem, "kind" | "mime" | "name" | "isLink" | "broken">): string {
  if (item.broken) return "Broken link";
  if (item.kind === "folder") return item.isLink ? "Folder (link)" : "Folder";
  const label = kindOf(item.mime);
  if (item.mime === UNKNOWN_TYPE) {
    const { ext } = splitName(item.name);
    return ext ? `${ext.slice(1).toUpperCase()} file` : "Document";
  }
  return label;
}

/** A fallback icon category for an item. */
export function itemCategory(item: Pick<FileItem, "kind" | "mime">): ReturnType<typeof categoryOf> {
  return item.kind === "folder" ? "folder" : categoryOf(item.mime);
}

function toItem(
  dir: string,
  name: string,
  lst: Stats | null,
  target: Stats | null,
  index: MimeIndex,
  hiddenNames: ReadonlySet<string>,
  linkName?: string,
): FileItem | null {
  if (!lst) return null;
  const isLink = lst.isSymbolicLink();
  const real = isLink ? target : lst;
  const kind: ItemKind = real?.isDirectory() ? "folder" : real?.isFile() ? "file" : "other";
  return {
    name,
    path: join(dir, name),
    kind,
    isLink,
    broken: isLink && target === null,
    size: kind === "file" ? (real?.size ?? 0) : 0,
    mtime: (real ?? lst).mtimeMs,
    mode: (real ?? lst).mode,
    hidden: name.startsWith(".") || name.endsWith("~") || hiddenNames.has(name),
    // A link is typed by what it points at ("link to report" is a text file).
    mime: kind === "folder" ? INODE_DIRECTORY : mimeOf(index, linkName ?? name),
  };
}

/** The file name a link points at, for typing it; undefined when it can't be read. */
async function linkTargetName(path: string): Promise<string | undefined> {
  try {
    return (await readlink(path)).split("/").filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

/** Files whose names say nothing, typed by their first bytes instead (at most `SNIFF_LIMIT` of them). */
async function sniffUnknown(items: FileItem[]): Promise<FileItem[]> {
  const unknown = items.filter((item) => item.kind === "file" && item.mime === UNKNOWN_TYPE && item.size > 0).slice(0, SNIFF_LIMIT);
  if (unknown.length === 0) return items;
  const found = new Map<string, string>();
  await Promise.all(
    unknown.map(async (item) => {
      const type = await sniffType(item.path);
      if (type) found.set(item.path, type);
    }),
  );
  return found.size === 0 ? items : items.map((item) => ({ ...item, mime: found.get(item.path) ?? item.mime }));
}

/** One item from a path, or null when it is gone. */
export async function itemAt(path: string, index: MimeIndex): Promise<FileItem | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash <= 0 ? "/" : path.slice(0, slash);
  const name = path.slice(slash + 1);
  try {
    const lst = await lstat(path);
    const target = lst.isSymbolicLink() ? await stat(path).catch(() => null) : lst;
    const item = toItem(dir, name, lst, target, index, new Set(), lst.isSymbolicLink() && target ? await linkTargetName(path) : undefined);
    return item ? ((await sniffUnknown([item]))[0] ?? item) : null;
  } catch {
    return null;
  }
}

/** Names the folder's `.hidden` file lists (GLib and Nautilus honor it). */
async function hiddenList(dir: string): Promise<Set<string>> {
  try {
    const text = await readFile(join(dir, ".hidden"), "utf8");
    return new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && checkName(line) === null),
    );
  } catch {
    return new Set();
  }
}

export interface Listing {
  items: FileItem[];
  error: string | null;
}

/** Read errors, said the way a person reads them. */
export function describeError(error: unknown, path: string): string {
  const code = (error as { code?: string } | null)?.code;
  const name = path.split("/").pop() || path;
  switch (code) {
    case "ENOENT":
      return `“${name}” doesn’t exist any more.`;
    case "EACCES":
    case "EPERM":
      return `You don’t have permission to open “${name}”.`;
    case "ENOTDIR":
      return `“${name}” isn’t a folder.`;
    case "EEXIST":
      return `“${name}” already exists.`;
    case "ENOSPC":
      return "There is no space left on the disk.";
    case "EROFS":
      return "The disk is read-only.";
    case "EXDEV":
      return "That can’t be moved across disks this way.";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

const BATCH = 64;

/** Every entry of `dir`. Entries that vanish while reading are left out. */
export async function readFolder(dir: string, index: MimeIndex, signal?: AbortSignal): Promise<Listing> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    return { items: [], error: describeError(error, dir) };
  }
  const hiddenNames = await hiddenList(dir);
  const items: FileItem[] = [];
  for (let at = 0; at < entries.length; at += BATCH) {
    if (signal?.aborted) break;
    const batch = entries.slice(at, at + BATCH);
    const stats = await Promise.all(
      batch.map(async (entry) => {
        const path = join(dir, entry.name);
        try {
          const lst = await lstat(path);
          const target = lst.isSymbolicLink() ? await stat(path).catch(() => null) : lst;
          return { lst, target, linkName: lst.isSymbolicLink() && target ? await linkTargetName(path) : undefined };
        } catch {
          return null;
        }
      }),
    );
    batch.forEach((entry, i) => {
      const got = stats[i];
      const item = got ? toItem(dir, entry.name, got.lst, got.target, index, hiddenNames, got.linkName) : null;
      if (item) items.push(item);
    });
  }
  return { items: signal?.aborted ? items : await sniffUnknown(items), error: null };
}
