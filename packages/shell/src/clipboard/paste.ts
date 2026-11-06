/**
 * A kept copy back on the clipboard (❖C in the history), and pasted into
 * the window that had the keyboard before the launcher opened (↩): the
 * copy goes on the clipboard first, and once the compositor says it is
 * there, that window gets the paste chord its app takes (⌃⇧V in a
 * terminal, ⌃V elsewhere).
 */

import { readFileSync } from "node:fs";
import { TERMINALS } from "../keymap.ts";
import type { ClipEntry } from "./history.ts";
import type { ClipboardIo } from "./io.ts";
import type { ClipboardWatch } from "./watch.ts";

/** How long a copy has to reach the clipboard before pasting goes ahead anyway. */
const SET_MS = 500;
/** A moment for the window to have the keyboard back once the launcher is gone. */
const FOCUS_MS = 80;

export interface PasteDeps {
  io: ClipboardIo;
  watch: Pick<ClipboardWatch, "expect" | "nextCopy">;
  imagePath(entry: ClipEntry): string | null;
  /** A compositor request (`send-keys`, `focus`). */
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** The chord that pastes in an app: terminals keep ⌃V for the program inside. */
export function pasteChord(appId: string): string {
  return TERMINALS.includes(appId) ? "ctrl+shift+v" : "ctrl+v";
}

/** What an entry puts on the clipboard. */
export function entryData(entry: ClipEntry, imagePath: (entry: ClipEntry) => string | null): Uint8Array | string | null {
  if (entry.kind !== "image") return entry.text ?? null;
  const path = imagePath(entry);
  if (!path) return null;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

/** Put `entry` on the clipboard; it stays where it is in the history, moved to the top. Resolves once it is there (or soon after). */
export async function copyEntry(entry: ClipEntry, deps: PasteDeps): Promise<boolean> {
  const data = entryData(entry, deps.imagePath);
  if (data === null) return false;
  deps.watch.expect(entry.kind, data, "bump");
  const there = deps.watch.nextCopy(SET_MS);
  if (!(await deps.io.write(entry.mime, data))) return false;
  await there;
  return true;
}

/** Copy `entry`, then paste it into `window`. */
export async function pasteEntry(entry: ClipEntry, window: { id: number; appId: string }, deps: PasteDeps): Promise<boolean> {
  if (!(await copyEntry(entry, deps))) return false;
  await Bun.sleep(FOCUS_MS);
  try {
    await deps.request("send-keys", { window: window.id, chord: pasteChord(window.appId) });
    return true;
  } catch {
    return false;
  }
}
