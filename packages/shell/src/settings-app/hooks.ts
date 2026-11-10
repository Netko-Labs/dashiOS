/** React's view of the stores Settings reads. */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Grants } from "../agents/index.ts";
import type { ScreensState, ScreensStore } from "./screens.ts";
import type { SettingsSnapshot, SettingsStore } from "./store.ts";

export const useSettings = (store: SettingsStore): SettingsSnapshot => useSyncExternalStore(store.subscribe, store.getSnapshot);
export const useScreens = (store: ScreensStore): ScreensState => useSyncExternalStore(store.subscribe, store.getSnapshot);

/** The kept agent answers, current while the pane is up. */
export function useGrantEntries(grants: Pick<Grants, "entries" | "onChange">): ReturnType<Grants["entries"]> {
  const [entries, setEntries] = useState(() => grants.entries());
  useEffect(() => {
    setEntries(grants.entries());
    return grants.onChange(() => setEntries(grants.entries()));
  }, [grants]);
  return entries;
}
