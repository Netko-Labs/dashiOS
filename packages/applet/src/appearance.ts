/**
 * Dark Mode in an applet: the shell keeps the switch in
 * `$XDG_STATE_HOME/dashi/control-center.json` (`{"dark": true, …}`), which
 * the sandbox shows read-only; this reads it once a second and tells
 * @dashi/ui's palette when it flips. Missing or unreadable is Light.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function appearancePath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "control-center.json");
}

/** `{"dark": true}` → true; anything else → false. */
export function darkFrom(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && (value as Record<string, unknown>).dark === true;
  } catch {
    return false;
  }
}

export interface Appearance {
  subscribe(listener: () => void): () => void;
  isDark(): boolean;
}

let shared: Appearance | null = null;

export function appearance(path = appearancePath()): Appearance {
  if (shared) return shared;
  const listeners = new Set<() => void>();
  const read = (): boolean => {
    try {
      return darkFrom(readFileSync(path, "utf8"));
    } catch {
      return false;
    }
  };
  let dark = read();
  const timer = setInterval(() => {
    const now = read();
    if (now === dark) return;
    dark = now;
    for (const listener of listeners) listener();
  }, 1000);
  timer.unref?.();
  shared = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isDark: () => dark,
  };
  return shared;
}
