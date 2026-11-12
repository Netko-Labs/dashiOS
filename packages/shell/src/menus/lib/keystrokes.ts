/**
 * The Edit menu stands for keystrokes in the focused app. Which chord a row
 * types is policy, decided here as keymap.ts decides what ❖ chords mean: an
 * app's own Ctrl chord, and Ctrl+Shift in a terminal, where plain Ctrl
 * chords belong to the program inside (Ctrl+C interrupts). The compositor
 * only types what it is told (IPC `send-keys`, comp/src/ipc/send_keys.rs).
 */

import { KEYMAP } from "../../keymap/index.ts";
import type { EditCommand } from "../types.ts";

/** The key each command is on, with Shift for the ones that need it. */
const KEYS: Record<EditCommand, { key: string; shift: boolean }> = {
  undo: { key: "z", shift: false },
  redo: { key: "z", shift: true },
  cut: { key: "x", shift: false },
  copy: { key: "c", shift: false },
  paste: { key: "v", shift: false },
  "select-all": { key: "a", shift: false },
  find: { key: "f", shift: false },
};

/** Whether `appId` matches a keymap app pattern: exact, or a prefix before a trailing `*` (as comp/src/keys/keymap.rs). */
export function matchesPattern(appId: string, pattern: string): boolean {
  return pattern.endsWith("*") ? appId.startsWith(pattern.slice(0, -1)) : appId === pattern;
}

/** Whether the app is one of the keymap's terminals. */
export function isTerminal(appId: string, terminals: readonly string[] = KEYMAP.apps.terminal ?? []): boolean {
  return terminals.some((pattern) => matchesPattern(appId, pattern));
}

/** The chord `command` types into `appId`'s window: "ctrl+c", or "ctrl+shift+c" in a terminal. */
export function editChord(command: EditCommand, appId: string): string {
  const { key, shift } = KEYS[command];
  return shift || isTerminal(appId) ? `ctrl+shift+${key}` : `ctrl+${key}`;
}
