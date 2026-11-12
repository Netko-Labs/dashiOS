/** The mixer's store as React reads it: the whole state, or only the part a surface redraws for. */

import { useSyncExternalStore } from "react";
import { micIndicator } from "./rows.ts";
import type { AppMixer, MixerState } from "./store.ts";

const QUIET: MixerState = { available: false, apps: [], recording: [], outputs: [], inputs: [] };
const NEVER = () => () => {};

/** What the microphone indicator says ("" while no app records from a microphone): the menu bar redraws only when it changes. */
export function useMicWords(store: AppMixer | undefined): string {
  return useSyncExternalStore(store?.subscribe ?? NEVER, () => (store ? micIndicator(store.getSnapshot().recording).words : ""));
}

/** An app with a row: its key and its name. */
export interface AppName {
  key: string;
  name: string;
}

const NO_NAMES: readonly AppName[] = [];
const namesCache = new WeakMap<AppMixer, { text: string; names: readonly AppName[] }>();

/** The apps' keys and names, for Settings' search: a window redraws only when an app comes or goes, not as a level moves. */
export function useAppNames(store: AppMixer | undefined): readonly AppName[] {
  return useSyncExternalStore(store?.subscribe ?? NEVER, () => {
    if (!store) return NO_NAMES;
    const names = store.getSnapshot().apps.map(({ key, name }) => ({ key, name }));
    const text = JSON.stringify(names);
    const cached = namesCache.get(store);
    if (cached?.text === text) return cached.names;
    namesCache.set(store, { text, names });
    return names;
  });
}

/** The mixer's state; without a mixer, no apps. */
export function useMixer(store: AppMixer | undefined): MixerState {
  return useSyncExternalStore(store?.subscribe ?? NEVER, store?.getSnapshot ?? (() => QUIET));
}
