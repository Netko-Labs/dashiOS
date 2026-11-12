/** User and group names for Get Info: `/etc/passwd` and `/etc/group` (what getpwuid reads on a system without a directory service). */

import { readFileSync } from "node:fs";

/** `name:x:uid:…` or `name:x:gid:…` lines as id to name. */
export function parseIds(text: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of text.split("\n")) {
    const [name, , id] = line.split(":");
    const number = Number(id);
    if (name && id !== undefined && id !== "" && Number.isInteger(number) && !names.has(number)) names.set(number, name);
  }
  return names;
}

function load(path: string): Map<number, string> {
  try {
    return parseIds(readFileSync(path, "utf8"));
  } catch {
    return new Map();
  }
}

let users: Map<number, string> | null = null;
let groups: Map<number, string> | null = null;

export const userName = (uid: number): string => (users ??= load("/etc/passwd")).get(uid) ?? String(uid);
export const groupName = (gid: number): string => (groups ??= load("/etc/group")).get(gid) ?? String(gid);
