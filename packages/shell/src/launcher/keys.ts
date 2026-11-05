/**
 * The launcher's keys beyond what its field reports. Metal's text input
 * tells the shell only Esc, ↑ and ↓ (and Enter); ⌃N, ⌃P, Page Up, Page Down,
 * Home and End reach it as nothing. So while the launcher is open the shell
 * sends the compositor a keymap with these rules first, as the app
 * switcher's session does (keymap.ts SWITCHER_RULES): the compositor reports
 * them as bindings, and the shell hands them to the open launcher.
 */

import type { Keymap, Rule } from "../keymap.ts";
import type { Move } from "./selection.ts";

/** Binding name → how it moves the selection. */
export const LAUNCHER_BINDINGS: Readonly<Record<string, Move>> = {
  "launcher-down": "down",
  "launcher-up": "up",
  "launcher-page-down": "page-down",
  "launcher-page-up": "page-up",
  "launcher-first": "first",
  "launcher-last": "last",
};

/** Bound only while the launcher is open, ahead of every other rule. Keysyms as xkb names them (Prior is Page Up). */
export const LAUNCHER_RULES: Rule[] = [
  { when: "ctrl+n", bind: "launcher-down" },
  { when: "ctrl+p", bind: "launcher-up" },
  { when: "Next|Page_Down", bind: "launcher-page-down" },
  { when: "Prior|Page_Up", bind: "launcher-page-up" },
  { when: "Home", bind: "launcher-first" },
  { when: "End", bind: "launcher-last" },
  // ❖↑ ❖↓: the first and the last row, as the keyboard contract has them.
  { when: "super+Up", bind: "launcher-first" },
  { when: "super+Down", bind: "launcher-last" },
];

/** The keymap while the launcher is open: its keys first. */
export const withLauncher = (keymap: Keymap): Keymap => ({ ...keymap, rules: [...LAUNCHER_RULES, ...keymap.rules] });

/** Where the open launcher hears those keys. */
export class LauncherKeys {
  private readonly listeners = new Set<(move: Move) => void>();

  subscribe = (listener: (move: Move) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A binding from the compositor; true if it was one of the launcher's. */
  binding(name: string): boolean {
    const move = LAUNCHER_BINDINGS[name];
    if (!move) return false;
    for (const listener of this.listeners) listener(move);
    return true;
  }
}
