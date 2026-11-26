/**
 * Control Center's switches that are only a promise to other parts of the
 * desktop: Do Not Disturb (the notification server reads it before showing a
 * banner), Dark Mode (the palette in theme.ts and the apps' settings in
 * appearance/ follow it), and Night Shift (night-shift.ts warms the screens). One store everyone shares, with the usual
 * subscribe/getSnapshot pair, remembered in
 * `$XDG_STATE_HOME/dashi/control-center.json` so a restart keeps them.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { isAccentHex, setAppearanceSource } from "@dashi/ui";
import { useSyncExternalStore } from "react";

export interface Flags {
  /** Banners and sounds are held back. */
  dnd: boolean;
  /**
   * Focus ends by itself then (ms since the epoch; Control Center's Focus page, CC-6), and the
   * choice that set it; absent: until it is turned off.
   */
  dndUntil?: number | undefined;
  dndFor?: FocusFor | undefined;
  /** Dark Mode: the shell paints with the dark palette and apps are asked to. */
  dark: boolean;
  /** Night Shift: the screens' colors are warmed. */
  night: boolean;
  /**
   * The accent's seed as the shell resolved it (appearance/accent.ts: a
   * preset's, a picked colour, or the wallpaper's), so every app's process
   * paints the same accent without finding the wallpaper's itself. Absent:
   * Kombu. settings.json's `appearance.accent` is the person's choice; this
   * is only what it came to.
   */
  accent?: string | undefined;
}

/** How long Focus was turned on for (design.html CC-6): an hour, until this evening, until tomorrow morning. */
export type FocusFor = "hour" | "evening" | "tomorrow";

const FOCUS_FOR: readonly FocusFor[] = ["hour", "evening", "tomorrow"];
const isFocusFor = (value: unknown): value is FocusFor => FOCUS_FOR.some((each) => each === value);

const DEFAULTS: Flags = { dnd: false, dark: false, night: false };

/** The saved flags; anything unreadable or of the wrong type is the default. */
export function parseFlags(text: string): Flags {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULTS;
  }
  if (!isRecord(value)) return DEFAULTS;
  const { dnd, dark, night, accent, dndUntil, dndFor } = value;
  const until = dnd === true && typeof dndUntil === "number" && Number.isFinite(dndUntil) && isFocusFor(dndFor) ? { dndUntil, dndFor } : {};
  return { dnd: dnd === true, ...until, dark: dark === true, night: night === true, ...(isAccentHex(accent) ? { accent: accent.toUpperCase() } : {}) };
}

const same = (a: Flags, b: Flags): boolean =>
  a.dnd === b.dnd && a.dark === b.dark && a.night === b.night && a.accent === b.accent && a.dndUntil === b.dndUntil && a.dndFor === b.dndFor;

export function flagsPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "control-center.json");
}

export class FlagsStore {
  private snapshot: Flags;
  private readonly listeners = new Set<() => void>();

  /** `path` null keeps the flags in memory only (tests). */
  constructor(private readonly path: string | null = flagsPath()) {
    this.snapshot = DEFAULTS;
    if (path) {
      try {
        this.snapshot = parseFlags(readFileSync(path, "utf8"));
      } catch {
        // First run, or unreadable: the defaults.
      }
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Flags => this.snapshot;

  /** Sets flags; the snapshot is replaced only when one changed. */
  set(patch: Partial<Flags>): void {
    const next = { ...this.snapshot, ...patch };
    if (next.accent === undefined) delete next.accent;
    // Focus off, or on with no end, forgets the end it had.
    if (!next.dnd || next.dndUntil === undefined || next.dndFor === undefined) {
      delete next.dndUntil;
      delete next.dndFor;
    }
    if (same(next, this.snapshot)) return;
    this.snapshot = next;
    this.save();
    for (const listener of this.listeners) listener();
  }

  /**
   * Takes flags another process saved (an app following the shell's file,
   * apps/kit/appearance.ts): listeners hear of a change, nothing is written.
   */
  adopt(flags: Flags): void {
    if (same(flags, this.snapshot)) return;
    this.snapshot = { ...flags };
    for (const listener of this.listeners) listener();
  }

  toggle(key: "dnd" | "dark" | "night"): void {
    // A switch turned by hand: Focus on is until it is turned off.
    this.set(key === "dnd" ? { dnd: !this.snapshot.dnd, dndUntil: undefined, dndFor: undefined } : { [key]: !this.snapshot[key] });
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify(this.snapshot)}\n`);
    } catch (error) {
      console.error("dashi-shell: could not save Control Center's switches:", error);
    }
  }
}

let shared: FlagsStore | null = null;

/** The desktop's one store; the notification server imports this. */
export function controlFlags(): FlagsStore {
  shared ??= new FlagsStore();
  return shared;
}

export function useFlags(store: FlagsStore): Flags {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Control Center's Dark Mode switch (and the accent the shell resolved) is what @dashi/ui paints by: each process
 * that renders (the shell, every first-party app) connects it once, before
 * its first render.
 */
export function connectDarkMode(): void {
  const flags = controlFlags();
  setAppearanceSource({ subscribe: flags.subscribe, isDark: () => flags.getSnapshot().dark, accent: () => flags.getSnapshot().accent ?? null });
}
