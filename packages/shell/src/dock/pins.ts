/**
 * Which apps are kept in the Dock, and in what order: a list of app ids in
 * `$XDG_CONFIG_HOME/dashi/dock.json`, written when the list changes (a person
 * may edit it by hand). Until the file exists the Dock keeps its defaults.
 * One store everyone shares, with the usual subscribe/getSnapshot pair.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { useSyncExternalStore } from "react";

/** More pins than any Dock could show; a file with more is not one of ours. */
const MAX_PINS = 100;
const MAX_ID_LENGTH = 256;

export function dockPath(env: Record<string, string | undefined> = process.env): string {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(config, "dashi", "dock.json");
}

const isAppId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);

/**
 * The pinned ids in a saved file, or null when it is not a Dock file: the
 * text is not JSON, `pinned` is not a list, or an id is not a plain string.
 * A repeated id counts once, at its first place.
 */
export function parsePins(text: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { pinned } = value;
  if (!Array.isArray(pinned) || pinned.length > MAX_PINS || !pinned.every(isAppId)) return null;
  return [...new Set<string>(pinned)];
}

export function serializePins(ids: readonly string[]): string {
  return `${JSON.stringify({ version: 1, pinned: ids }, null, 2)}\n`;
}

/**
 * `all` with the ids in `order` rearranged into that order, in the places
 * they already held. Ids of `all` that `order` leaves out (apps that are not
 * installed here, so the Dock does not show them) keep their places. `all`
 * itself when `order` is not a rearrangement of some of its ids.
 */
export function applyOrder(all: readonly string[], order: readonly string[]): readonly string[] {
  const listed = new Set(order);
  if (listed.size !== order.length || order.some((id) => !all.includes(id))) return all;
  let next = 0;
  return all.map((id) => (listed.has(id) ? (order[next++] as string) : id));
}

export interface PinStoreOptions {
  /** What the Dock keeps before anything is saved. */
  defaults: readonly string[];
  /** The file; null keeps the list in memory only (tests). */
  path?: string | null;
}

export class PinStore {
  private snapshot: readonly string[];
  private readonly path: string | null;
  private readonly listeners = new Set<() => void>();

  constructor({ defaults, path = dockPath() }: PinStoreOptions) {
    this.path = path;
    this.snapshot = [...new Set(defaults)];
    if (!path) return;
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // First run, or unreadable: the defaults.
      return;
    }
    const saved = parsePins(text);
    if (saved) this.snapshot = saved;
    else console.error(`dashi-shell: ${path} is not a Dock file ({"pinned": ["app.id", …]}); using the defaults`);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly string[] => this.snapshot;

  isPinned(id: string): boolean {
    return this.snapshot.includes(id);
  }

  /** Keeps `id` in the Dock, after the others. */
  pin(id: string): void {
    if (!isAppId(id) || this.isPinned(id) || this.snapshot.length >= MAX_PINS) return;
    this.set([...this.snapshot, id]);
  }

  unpin(id: string): void {
    if (this.isPinned(id)) this.set(this.snapshot.filter((each) => each !== id));
  }

  /** Puts the pinned apps in `order` (see `applyOrder`). */
  reorder(order: readonly string[]): void {
    this.set(applyOrder(this.snapshot, order));
  }

  private set(next: readonly string[]): void {
    if (next.length === this.snapshot.length && next.every((id, index) => id === this.snapshot[index])) return;
    this.snapshot = next;
    this.save();
    for (const listener of this.listeners) listener();
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // Written whole, then moved over the old file, so a crash leaves one or the other.
      const temp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temp, serializePins(this.snapshot));
      renameSync(temp, this.path);
    } catch (error) {
      console.error("dashi-shell: could not save the Dock's apps:", error);
    }
  }
}

export function usePins(store: PinStore): readonly string[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
