/**
 * The launcher's keys beyond what its field reports. Metal's text input
 * tells the shell only Esc, ↑ and ↓ (and Enter); ⌃N, ⌃P, Page Up, Page Down,
 * Home and End reach it as nothing, and so do ❖K, ❖↩, ⌥↩, ⇧↩, ❖C and ❖1–9
 * (the keyboard contract, betterments.html "Ranking and keys"). So while
 * the launcher is open the shell sends the compositor a keymap with these
 * rules first, as the app switcher's session does (keymap.ts
 * SWITCHER_RULES): the compositor reports them as bindings, and the shell
 * hands them to the open launcher. Holding ❖ shows the digits ❖1–9 pick
 * (the shortcut sheet's hold, while the launcher is open).
 *
 * While Set shortcut… records a chord, every ❖ chord is the launcher's
 * (person-keys.ts RECORD_RULES), so a chord Dashi or an app uses can still
 * be recorded, and the recorder says what it did.
 */

import type { Keymap, Rule } from "../keymap.ts";
import { RECORD_BINDING, RECORD_RULES, type ReportedChord } from "./person-keys.ts";
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

/** What the other keys ask of the open launcher. */
export type LauncherCommand =
  | { kind: "actions" }
  | { kind: "secondary" }
  | { kind: "third" }
  /** ⇧↩: do the row's thing and stay open for the next one. */
  | { kind: "keep-open" }
  | { kind: "copy" }
  | { kind: "alias" }
  | { kind: "shortcut" }
  | { kind: "quit" }
  /** ❖1–9: the row with that digit. */
  | { kind: "pick"; digit: number }
  /** ❖ held (the digits show) or let go. */
  | { kind: "digits"; shown: boolean }
  /** A chord pressed while Set shortcut… records. */
  | { kind: "record"; chord: ReportedChord };

const COMMANDS: Readonly<Record<string, LauncherCommand>> = {
  "launcher-actions": { kind: "actions" },
  "launcher-secondary": { kind: "secondary" },
  "launcher-third": { kind: "third" },
  "launcher-keep-open": { kind: "keep-open" },
  "launcher-copy": { kind: "copy" },
  "launcher-alias": { kind: "alias" },
  "launcher-shortcut": { kind: "shortcut" },
  "launcher-quit": { kind: "quit" },
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
  // The action list and the keys that need no list. The ⇧ ones first: a rule without Shift matches with it held too.
  { when: "super+shift+a", bind: "launcher-alias" },
  { when: "super+shift+k", bind: "launcher-shortcut" },
  { when: "super+k", bind: "launcher-actions" },
  { when: "super+Return|KP_Enter", bind: "launcher-secondary" },
  { when: "alt+Return|KP_Enter", bind: "launcher-third" },
  { when: "shift+Return|KP_Enter", bind: "launcher-keep-open" },
  { when: "super+c", bind: "launcher-copy" },
  { when: "super+q", bind: "launcher-quit" },
  ...Array.from({ length: 9 }, (_, index) => ({ when: `super+${index + 1}`, bind: `launcher-pick-${index + 1}` })),
];

/** The keymap while the launcher is open: its keys first, and every ❖ chord while it records one. */
export const withLauncher = (keymap: Keymap, recording = false): Keymap => ({
  ...keymap,
  rules: [...(recording ? RECORD_RULES : []), ...LAUNCHER_RULES, ...keymap.rules],
});

/** Where the open launcher hears those keys. */
export class LauncherKeys {
  private readonly listeners = new Set<(move: Move) => void>();
  private readonly commandListeners = new Set<(command: LauncherCommand) => void>();
  private recordingNow = false;
  /** Told when recording starts or stops, to send the keymap that goes with it (main.tsx). */
  onRecording: ((recording: boolean) => void) | null = null;

  subscribe = (listener: (move: Move) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeCommands = (listener: (command: LauncherCommand) => void): (() => void) => {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  };

  get recording(): boolean {
    return this.recordingNow;
  }

  /** Set shortcut… starts or stops listening for a chord. */
  record(on: boolean): void {
    if (this.recordingNow === on) return;
    this.recordingNow = on;
    this.onRecording?.(on);
  }

  /** ❖ held (true) or let go: the digits ❖1–9 pick show while it is held; true if the launcher heard it. */
  digits(shown: boolean): boolean {
    if (this.commandListeners.size === 0) return false;
    this.command({ kind: "digits", shown });
    return true;
  }

  private command(command: LauncherCommand): void {
    for (const listener of this.commandListeners) listener(command);
  }

  /** A binding from the compositor; true if it was one of the launcher's. */
  binding(name: string, chord?: ReportedChord): boolean {
    if (name === RECORD_BINDING) {
      if (chord && this.recordingNow) this.command({ kind: "record", chord });
      return true;
    }
    const pick = /^launcher-pick-([1-9])$/.exec(name);
    if (pick) {
      this.command({ kind: "pick", digit: Number(pick[1]) });
      return true;
    }
    const command = COMMANDS[name];
    if (command) {
      this.command(command);
      return true;
    }
    const move = LAUNCHER_BINDINGS[name];
    if (!move) return false;
    for (const listener of this.listeners) listener(move);
    return true;
  }
}
