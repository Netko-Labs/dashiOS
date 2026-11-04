/**
 * Whom the agent speaks for: polkitd keeps one agent per subject and asks it
 * about actions requested from that subject. Ours is the login session
 * (`unix-session`, from XDG_SESSION_ID), the way desktop agents register; a
 * shell started outside any logind session falls back to its own process
 * (`unix-process`, identified by pid and start time so a reused pid is not
 * mistaken for it).
 */

import { readFileSync } from "node:fs";
import { type Variant, variant } from "../dbus/index.ts";

/** polkit's `Subject`: a kind and its details, `(sa{sv})`. */
export type Subject = readonly [kind: string, details: Map<string, Variant>];

const SESSION_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** Field 22 of /proc/<pid>/stat, in clock ticks since boot: the process's start time. */
export function parseStartTime(stat: string): bigint | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  // After "(comm)": state is field 3, so field 22 is the 20th word.
  const field = stat
    .slice(close + 1)
    .trim()
    .split(" ")[19];
  return field !== undefined && /^[0-9]+$/.test(field) ? BigInt(field) : null;
}

export function sessionSubject(
  env: Record<string, string | undefined> = process.env,
  pid = process.pid,
  readStat: (pid: number) => string | null = (target) => {
    try {
      return readFileSync(`/proc/${target}/stat`, "utf8");
    } catch {
      return null;
    }
  },
): Subject | null {
  const session = env.XDG_SESSION_ID;
  if (session && SESSION_ID.test(session)) return ["unix-session", new Map([["session-id", variant("s", session)]])];
  const start = parseStartTime(readStat(pid) ?? "");
  if (start === null) return null;
  return [
    "unix-process",
    new Map([
      ["pid", variant("u", pid)],
      ["start-time", variant("t", start)],
    ]),
  ];
}

/** polkitd translates its messages by this; anything odd falls back to a locale every system has. */
export function agentLocale(env: Record<string, string | undefined> = process.env): string {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^[A-Za-z0-9_.@-]{1,64}$/.test(locale) ? locale : "en_US.UTF-8";
}
