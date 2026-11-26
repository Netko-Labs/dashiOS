/**
 * Which palette to paint with. Dark Mode is the host's decision (the shell's
 * Control Center keeps it), so @dashi/ui only reads it through this store: a
 * process connects its source once, before it renders anything
 * (`setAppearanceSource`), and every component repaints when it changes.
 * Unconnected, everything paints light.
 *
 * `Appearance` paints one part of a window in a mode of its own, whatever
 * Dark Mode says: the Components gallery shows each control in Light and
 * Dark side by side with it. Apps don't use it (every window follows Dark
 * Mode, CO-8); it is for showing both.
 *
 * The same source says the person's accent (accent/: the seed, already
 * resolved, the wallpaper's included); a source without one, or null, is
 * Kombu, Dashi's own.
 */

import { createContext, createElement, type ReactNode, useContext, useSyncExternalStore } from "react";
import { OnGlassContext, paintedPalette, WindowFocusContext } from "./on-glass.ts";
import type { Palette } from "./palette.ts";
import { paletteFor } from "./palette-for.ts";

export interface AppearanceSource {
  subscribe(listener: () => void): () => void;
  isDark(): boolean;
  /** The accent's seed (`#RRGGBB`), or null for Kombu. */
  accent?(): string | null;
}

const LIGHT: AppearanceSource = { subscribe: () => () => {}, isDark: () => false };

let source: AppearanceSource = LIGHT;

/** Connect where Dark Mode comes from; call it before the first render. */
export function setAppearanceSource(next: AppearanceSource): void {
  source = next;
}

/** A mode fixed for part of the tree (`Appearance`), or null to follow Dark Mode. */
const Fixed = createContext<boolean | null>(null);

/** Everything under it paints in `dark` (true) or light (false), whatever Dark Mode is. */
export function Appearance({ dark, children }: { dark: boolean; children?: ReactNode }): ReactNode {
  return createElement(Fixed.Provider, { value: dark }, children);
}

/** Dark Mode, right now (or the mode an `Appearance` above fixed); repaints the caller when it flips. */
export function useDark(): boolean {
  const fixed = useContext(Fixed);
  const live = useSyncExternalStore(source.subscribe, source.isDark);
  return fixed ?? live;
}

const noAccent = (): null => null;

/** The accent's seed right now (null: Kombu); repaints the caller when it changes. */
export function useAccent(): string | null {
  return useSyncExternalStore(source.subscribe, source.accent ?? noAccent);
}

/**
 * The palette to paint with right now: on glass (`Frosted` above) its glass twin, and in a window without
 * focus with a neutral selection (theme/on-glass.ts).
 */
export function useColors(): Palette {
  const dark = useDark();
  return paintedPalette(paletteFor(dark, useAccent()), dark, useContext(OnGlassContext), useContext(WindowFocusContext));
}
