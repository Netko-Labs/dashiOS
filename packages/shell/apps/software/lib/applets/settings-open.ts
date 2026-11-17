/**
 * Which extension's Settings… sheet (frame S5) is open in the Store: one at
 * a time, opened from its Installed row, closed with Done or Esc.
 */

import { useSyncExternalStore } from "react";

let open: string | null = null;
const listeners = new Set<() => void>();

const tell = (): void => {
  for (const listener of [...listeners]) listener();
};

export const settingsSheet = {
  open(id: string): void {
    open = id;
    tell();
  },
  close(): void {
    open = null;
    tell();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  current: (): string | null => open,
};

/** The extension whose Settings… is open, or null. */
export function useSettingsOpen(): string | null {
  return useSyncExternalStore(settingsSheet.subscribe, settingsSheet.current);
}
