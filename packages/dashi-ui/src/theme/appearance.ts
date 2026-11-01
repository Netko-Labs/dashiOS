/**
 * Which palette to paint with. Dark Mode is the host's decision (the shell's
 * Control Center keeps it), so @dashi/ui only reads it through this store: a
 * process connects its source once, before it renders anything
 * (`setAppearanceSource`), and every component repaints when it changes.
 * Unconnected, everything paints light.
 */

import { useSyncExternalStore } from "react";
import { type Palette, paletteFor } from "./palette.ts";

export interface AppearanceSource {
  subscribe(listener: () => void): () => void;
  isDark(): boolean;
}

const LIGHT: AppearanceSource = { subscribe: () => () => {}, isDark: () => false };

let source: AppearanceSource = LIGHT;

/** Connect where Dark Mode comes from; call it before the first render. */
export function setAppearanceSource(next: AppearanceSource): void {
  source = next;
}

/** Dark Mode, right now; repaints the caller when it flips. */
export function useDark(): boolean {
  return useSyncExternalStore(source.subscribe, source.isDark);
}

/** The palette to paint with right now. */
export function useColors(): Palette {
  return paletteFor(useDark());
}
