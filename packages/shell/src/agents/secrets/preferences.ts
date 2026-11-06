/**
 * Settings › Passwords: which sources the broker asks (Dashi's vault,
 * 1Password) and where new logins are saved. Kept in
 * `$XDG_CONFIG_HOME/dashi/passwords.json`, beside settings.json; agents in
 * their sandbox can read but not change it (sandbox.ts).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SourceId } from "./sources.ts";

export interface PasswordPrefs {
  sources: Record<SourceId, boolean>;
  saveTo: SourceId;
}

export const DEFAULT_PREFS: PasswordPrefs = { sources: { dashi: true, "1password": false }, saveTo: "dashi" };

/** The file's contents to preferences; anything unknown or malformed is the default. */
export function parsePrefs(value: unknown): PasswordPrefs {
  if (typeof value !== "object" || value === null) return structuredClone(DEFAULT_PREFS);
  const record = value as Record<string, unknown>;
  const sources = typeof record.sources === "object" && record.sources !== null ? (record.sources as Record<string, unknown>) : {};
  const flag = (id: SourceId) => (typeof sources[id] === "boolean" ? (sources[id] as boolean) : DEFAULT_PREFS.sources[id]);
  return {
    sources: { dashi: flag("dashi"), "1password": flag("1password") },
    saveTo: record.saveTo === "1password" ? "1password" : "dashi",
  };
}

export function prefsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "dashi/passwords.json");
}

export class PasswordPrefsStore {
  private prefs: PasswordPrefs;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly path = prefsPath()) {
    let value: unknown = null;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // No file yet: the defaults.
    }
    this.prefs = parsePrefs(value);
  }

  getSnapshot = (): PasswordPrefs => this.prefs;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(change: Partial<PasswordPrefs>): void {
    this.prefs = parsePrefs({ ...this.prefs, ...change, sources: { ...this.prefs.sources, ...change.sources } });
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(`${this.path}.new`, JSON.stringify(this.prefs, null, 2));
      renameSync(`${this.path}.new`, this.path);
    } catch (error) {
      console.error("dashi-shell: could not save the password settings:", error);
    }
    for (const listener of this.listeners) listener();
  }

  /** The sources the broker asks, in order. */
  enabled(): SourceId[] {
    return (["dashi", "1password"] as const).filter((id) => this.prefs.sources[id]);
  }
}
