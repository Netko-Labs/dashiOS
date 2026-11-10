/**
 * When each login outside Dashi's vault was last used through Dashi, for the
 * sheet's order (Dashi's vault keeps its own). Ids and times only, in
 * `$XDG_STATE_HOME/dashi/agents/logins-used.json`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { UsedStore } from "./onepassword.ts";

const MAX_ENTRIES = 2000;

export function fileUsedStore(path = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "dashi/agents/logins-used.json")): UsedStore {
  const times = new Map<string, number>();
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof value === "object" && value !== null) {
      for (const [key, at] of Object.entries(value)) if (typeof at === "number" && Number.isFinite(at)) times.set(key, at);
    }
  } catch {
    // Nothing used yet.
  }
  return {
    get: (key) => times.get(key) ?? null,
    set(key, at) {
      times.delete(key);
      times.set(key, at);
      while (times.size > MAX_ENTRIES) times.delete(times.keys().next().value as string);
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(Object.fromEntries(times)));
      } catch (error) {
        console.error("dashi-shell: could not note when a login was used:", error);
      }
    },
  };
}
