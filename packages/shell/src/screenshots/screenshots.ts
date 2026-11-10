/**
 * ⇧❖3 and ⇧❖4 (keymap.ts): a PNG of the screen, an area of it, or a window,
 * saved to ~/Pictures/Screenshots with the name macOS gives it. dashi-comp
 * encodes and writes the file (comp/src/capture.rs); this module picks the
 * name and asks.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Compositor } from "../compositor.ts";

/** Paths of captures still being written: a second press in the same second must not reuse one. */
const inFlight = new Set<string>();

/** Where screenshots go. HOME is read on each use (os.homedir() caches it), so a test can point it elsewhere. */
export function screenshotDirectory(): string {
  return join(process.env.HOME || homedir(), "Pictures", "Screenshots");
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The file name for a capture taken at `when`, in local time (no colons, since
 * some file systems and tools reject them): "Screenshot 2026-10-30 at
 * 01.23.45.png". A second capture in the same second gets " (2)", " (3)", …
 * `taken` says which names are already in use.
 */
export function screenshotName(when: Date, taken: (name: string) => boolean): string {
  const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}.${pad(when.getMinutes())}.${pad(when.getSeconds())}`;
  const stem = `Screenshot ${day} at ${time}`;
  const named = (copy: number): string => `${copy === 1 ? stem : `${stem} (${copy})`}.png`;
  let copy = 1;
  while (taken(named(copy))) copy += 1;
  return named(copy);
}

/**
 * Save a PNG of the screen, of `rect` on it (global logical pixels), or of
 * `window` (the compositor's window number).
 * Resolves with the path once dashi-comp has written it; rejects with its
 * error (for example, a window with no surface).
 */
export async function takeScreenshot(
  compositor: Pick<Compositor, "capture">,
  options: { window?: number; rect?: { x: number; y: number; width: number; height: number } } = {},
): Promise<string> {
  const dir = screenshotDirectory();
  mkdirSync(dir, { recursive: true });
  // Picking the name and reserving it happen with no await between them.
  const taken = (name: string): boolean => {
    const file = join(dir, name);
    return inFlight.has(file) || existsSync(file);
  };
  const path = join(dir, screenshotName(new Date(), taken));
  inFlight.add(path);
  try {
    await compositor.capture({
      path,
      ...(options.window === undefined ? {} : { window: options.window }),
      ...(options.rect === undefined ? {} : { rect: options.rect }),
    });
  } finally {
    inFlight.delete(path);
  }
  console.log(`dashi-shell: screenshot saved to ${path}`);
  return path;
}
