/**
 * Who can log in: the accounts in /etc/passwd with a regular user id (between
 * login.defs's UID_MIN and UID_MAX) and a shell that lets them in.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";

export interface User {
  name: string;
  /** The full name from the account's comment field, or the user name. */
  displayName: string;
  uid: number;
  /** Their account picture (AccountsService's), when they chose one. */
  picture?: string;
}

/** Where AccountsService keeps the pictures people chose. */
const PICTURES = "/var/lib/AccountsService/icons";
/** A picture bigger than this is not shown (it would be read and decoded). */
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;

/** The first bytes of a file. */
function readHead(path: string, bytes = 16): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const head = new Uint8Array(bytes);
    return head.subarray(0, readSync(fd, head, 0, bytes, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether mirin's host draws a picture that starts with these bytes: PNG, JPEG,
 * GIF, WebP or BMP. Any other (a TIFF, a HEIC) would be a blank circle, so the
 * person's initials are shown (the shell's `hostDraws` is the same rule, with SVG and ICO).
 */
export function drawn(head: Uint8Array): boolean {
  const starts = (...bytes: number[]): boolean => bytes.every((byte, index) => head[index] === byte);
  const webp = starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  return starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || starts(0x47, 0x49, 0x46, 0x38) || webp || starts(0x42, 0x4d);
}

/** `name`'s account picture, if there is a reasonable one the host draws. */
export function accountPicture(name: string, dir = PICTURES): string | undefined {
  if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(name)) return undefined;
  const path = `${dir}/${name}`;
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0 && stat.size <= MAX_PICTURE_BYTES && drawn(readHead(path)) ? path : undefined;
  } catch {
    return undefined;
  }
}

const NO_LOGIN = /(^|\/)(nologin|false)$/;

/** UID_MIN and UID_MAX from login.defs's text; Fedora's defaults when absent. */
export function uidRange(loginDefs: string): { min: number; max: number } {
  const value = (key: string, fallback: number): number => {
    const match = loginDefs.match(new RegExp(`^\\s*${key}\\s+(\\d+)`, "m"));
    return match ? Number(match[1]) : fallback;
  };
  return { min: value("UID_MIN", 1000), max: value("UID_MAX", 60000) };
}

/** The people in passwd's text who can log in, by display name. */
export function parseUsers(passwd: string, range: { min: number; max: number }): User[] {
  return passwd
    .split("\n")
    .flatMap((line): User[] => {
      const fields = line.split(":");
      if (fields.length < 7) return [];
      const [name, , uidText, , gecos, , shell] = fields as [string, string, string, string, string, string, string];
      const uid = Number(uidText);
      if (!name || !Number.isInteger(uid) || uid < range.min || uid > range.max || NO_LOGIN.test(shell.trim())) return [];
      const full = gecos.split(",")[0]?.trim();
      return [{ name, displayName: full || name, uid }];
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function loadUsers(): User[] {
  const read = (path: string): string => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };
  return parseUsers(read("/etc/passwd"), uidRange(read("/etc/login.defs"))).map((user) => {
    const picture = accountPicture(user.name);
    return picture ? { ...user, picture } : user;
  });
}
