/**
 * Who can log in: the accounts in /etc/passwd with a regular user id (between
 * login.defs's UID_MIN and UID_MAX) and a shell that lets them in.
 */

import { readFileSync } from "node:fs";

export interface User {
  name: string;
  /** The full name from the account's comment field, or the user name. */
  displayName: string;
  uid: number;
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
  return parseUsers(read("/etc/passwd"), uidRange(read("/etc/login.defs")));
}
