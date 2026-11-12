/**
 * Who logged in last, and into what: the greeter starts there next time.
 * Kept in the greeter's own state folder; losing it only costs a click.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";

export interface Last {
  user: string | null;
  session: string | null;
}

export function memoryPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi-greeter", "last.json");
}

export function parseLast(text: string): Last {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return { user: null, session: null };
    const { user, session } = value;
    return { user: typeof user === "string" ? user : null, session: typeof session === "string" ? session : null };
  } catch {
    return { user: null, session: null };
  }
}

export function recall(path = memoryPath()): Last {
  try {
    return parseLast(readFileSync(path, "utf8"));
  } catch {
    return { user: null, session: null };
  }
}

export function remember(last: Last, path = memoryPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(last)}\n`);
  } catch (error) {
    console.error("dashi-greeter: could not remember the login:", error);
  }
}
