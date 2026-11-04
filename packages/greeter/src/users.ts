/**
 * Who can log in: the accounts in /etc/passwd with a regular user id (between
 * login.defs's UID_MIN and UID_MAX) and a shell that lets them in.
 */

import { readFileSync, statSync } from "node:fs";

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

/** `name`'s account picture, if there is a reasonable one. */
export function accountPicture(name: string, dir = PICTURES): string | undefined {
  if (!/^[a-z_][a-z0-9_.-]*\$?$/i.test(name)) return undefined;
  const path = `${dir}/${name}`;
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0 && stat.size <= MAX_PICTURE_BYTES ? path : undefined;
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
