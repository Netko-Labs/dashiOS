/** What Get Info shows for one item, read in one go (a folder's size is measured separately, in the background). */

import { lstat, readlink, stat } from "node:fs/promises";
import { describeError, type FileItem, kindText, tilde } from "../../../src/shared/files/index.ts";
import { octal, permissionString } from "./format.ts";
import { groupName, userName } from "./ids.ts";

export interface ItemInfo {
  name: string;
  path: string;
  kind: string;
  mime: string;
  /** Bytes for a file; null for a folder until measured. */
  size: number | null;
  where: string;
  modified: number;
  accessed: number;
  /** Not every filesystem records a birth time. */
  created: number | null;
  permissions: string;
  octal: string;
  owner: string;
  group: string;
  /** What a symbolic link points to. */
  target: string | null;
  isFolder: boolean;
}

export async function loadInfo(item: FileItem, home: string): Promise<ItemInfo | string> {
  try {
    const link = await lstat(item.path);
    const real = link.isSymbolicLink() ? await stat(item.path).catch(() => link) : link;
    const target = link.isSymbolicLink() ? await readlink(item.path).catch(() => null) : null;
    const folder = real.isDirectory();
    return {
      name: item.name,
      path: item.path,
      kind: kindText(item),
      mime: item.mime,
      size: folder ? null : real.size,
      where: tilde(item.path.slice(0, item.path.lastIndexOf("/")) || "/", home),
      modified: real.mtimeMs,
      accessed: real.atimeMs,
      created: real.birthtimeMs > 0 ? real.birthtimeMs : null,
      permissions: permissionString(real.mode),
      octal: octal(real.mode),
      owner: userName(real.uid),
      group: groupName(real.gid),
      target,
      isFolder: folder,
    };
  } catch (error) {
    return describeError(error, item.path);
  }
}
