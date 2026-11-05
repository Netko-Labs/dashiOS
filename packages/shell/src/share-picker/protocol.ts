/**
 * The share picker's wire: `dashi-share-picker` (bin/dashi-share-picker.ts),
 * which xdg-desktop-portal-wlr runs as its `chooser_cmd`, asks the running
 * shell over `$XDG_RUNTIME_DIR/dashi-share.sock` (one JSON line each way)
 * and prints what the person chose in the form the wlr portal reads
 * (xdg-desktop-portal-wlr(5), "OUTPUT CHOOSER", simple choosers):
 * `Monitor: <output name>` or `Window: <ext-foreign-toplevel-list
 * identifier>`; nothing printed is "declined".
 *
 *   → {"pick": {}}
 *   ← {"choice": "Monitor: eDP-1"}     or {"choice": null}
 */

import { join } from "node:path";

/** What can be shared: a screen by its output name, or a window by its ext-foreign-toplevel-list identifier. */
export type ShareChoice = { kind: "screen"; output: string } | { kind: "window"; toplevel: string };

/** The longest line either side reads: a request or an answer is far shorter. */
export const MAX_LINE = 4096;

export function socketPath(env: Record<string, string | undefined> = process.env): string | null {
  if (env.DASHI_SHARE_SOCKET) return env.DASHI_SHARE_SOCKET;
  return env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "dashi-share.sock") : null;
}

/** Names the portal can read back: no line breaks, nothing odd. */
const isWireName = (value: string): boolean => /^[A-Za-z0-9_.:@-]{1,256}$/.test(value);

/** The line the wlr portal reads for `choice`; null when the name can't be written safely. */
export function choiceLine(choice: ShareChoice): string | null {
  if (choice.kind === "screen") return isWireName(choice.output) ? `Monitor: ${choice.output}` : null;
  return isWireName(choice.toplevel) ? `Window: ${choice.toplevel}` : null;
}

/** A request line from the picker command: only `{"pick": {...}}` is one. */
export function isPickRequest(line: string): boolean {
  if (line.length > MAX_LINE) return false;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null && "pick" in value;
  } catch {
    return false;
  }
}

/** The shell's answer as the command reads it: the line to print, or null (declined, or not an answer). */
export function parseAnswer(line: string): string | null {
  if (line.length > MAX_LINE) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const choice = (value as { choice?: unknown }).choice;
  if (typeof choice !== "string") return null;
  return /^(Monitor|Window): [A-Za-z0-9_.:@-]{1,256}$/.test(choice) ? choice : null;
}
