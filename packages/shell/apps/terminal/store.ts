/**
 * Each tab's screen, kept outside the window's React state: dashi-term
 * sends up to 125 frames a second, and a frame should redraw the rows that
 * changed, not the tab strip and the menus. The grid subscribes to the tab
 * in front (`useScreen`); the window renders only when a tab's name or the
 * tab list changes.
 */

import { useCallback, useSyncExternalStore } from "react";
import { EMPTY_SCREEN, type Screen } from "./screen.ts";

export class ScreenStore {
  #screens = new Map<number, Screen>();
  #listeners = new Map<number, Set<() => void>>();

  get(id: number): Screen {
    return this.#screens.get(id) ?? EMPTY_SCREEN;
  }

  /** Tab `id`'s screen after `change`; its listeners hear only when it is a new object. */
  update(id: number, change: (screen: Screen) => Screen): void {
    const before = this.get(id);
    const after = change(before);
    if (after === before) return;
    this.#screens.set(id, after);
    for (const listener of this.#listeners.get(id) ?? []) listener();
  }

  delete(id: number): void {
    this.#screens.delete(id);
    this.#listeners.delete(id);
  }

  subscribe(id: number, listener: () => void): () => void {
    const listeners = this.#listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
    };
  }
}

/** Tab `id`'s screen, re-rendering when it changes. */
export function useScreen(store: ScreenStore, id: number): Screen {
  return useScreenPart(store, id, (screen) => screen);
}

/** One part of tab `id`'s screen (whether something is selected), re-rendering only when that part changes. */
export function useScreenPart<T>(store: ScreenStore, id: number, part: (screen: Screen) => T): T {
  const subscribe = useCallback((listener: () => void) => store.subscribe(id, listener), [store, id]);
  const snapshot = (): T => part(store.get(id));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
