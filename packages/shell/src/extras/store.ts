/**
 * Every menu bar extra on the desktop, from every source, in the order the
 * bar shows them: newest leftmost, as on a Mac, where a new extra appears at
 * the left of the others. Sources put and drop their extras; each source
 * answers for its own (`owner`).
 */

import { useSyncExternalStore } from "react";
import type { ExtraActions, ExtraMenuRow, MenuBarExtra } from "./types.ts";

export class ExtrasStore implements ExtraActions {
  private extras: readonly MenuBarExtra[] = [];
  private readonly owners = new Map<string, ExtraActions>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly MenuBarExtra[] => this.extras;

  /** Add or replace an extra; `owner` carries out what is asked of it. A replaced extra keeps its place. */
  put(extra: MenuBarExtra, owner: ExtraActions): void {
    this.owners.set(extra.key, owner);
    const at = this.extras.findIndex((each) => each.key === extra.key);
    if (at >= 0) {
      if (JSON.stringify(this.extras[at]) === JSON.stringify(extra)) return;
      this.extras = this.extras.map((each, index) => (index === at ? extra : each));
    } else {
      this.extras = [extra, ...this.extras];
    }
    this.changed();
  }

  drop(key: string): void {
    if (!this.owners.delete(key)) return;
    this.extras = this.extras.filter((each) => each.key !== key);
    this.changed();
  }

  /** Every extra of one source goes (its connection closed). */
  dropWhere(match: (extra: MenuBarExtra) => boolean): void {
    const gone = this.extras.filter(match);
    if (gone.length === 0) return;
    for (const extra of gone) this.owners.delete(extra.key);
    this.extras = this.extras.filter((extra) => !match(extra));
    this.changed();
  }

  activate(key: string, x: number, y: number, output?: string): void {
    this.owners.get(key)?.activate(key, x, y, output);
  }

  secondaryActivate(key: string, x: number, y: number): void {
    this.owners.get(key)?.secondaryActivate(key, x, y);
  }

  menu(key: string): Promise<readonly ExtraMenuRow[]> {
    return this.owners.get(key)?.menu(key) ?? Promise.resolve([]);
  }

  choose(key: string, id: string): void {
    this.owners.get(key)?.choose(key, id);
  }

  menuClosed(key: string): void {
    this.owners.get(key)?.menuClosed?.(key);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

export function useExtras(store: ExtrasStore): readonly MenuBarExtra[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
