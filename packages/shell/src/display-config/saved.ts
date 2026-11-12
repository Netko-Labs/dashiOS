/**
 * Saved arrangements: `$XDG_CONFIG_HOME/dashi/displays.json`, one layout per
 * set of connected monitors (`setKey`), so plugging the same monitors back in
 * restores where each sat, what it ran, and which was the main one. Written
 * when a person (or an agent) changes the arrangement; a person may edit it.
 * The file is untrusted input: every field is checked.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { type Mode, ROTATIONS, type Rotation } from "./monitors.ts";

/** More arrangements than anyone has monitor sets; the oldest are dropped. */
const MAX_LAYOUTS = 50;
const MAX_MONITORS = 16;
const MAX_KEY = 1024;
const FAR = 100_000;

/** What was saved about one monitor. */
export interface SavedMonitor {
  enabled: boolean;
  /** Points, where its top-left sits in the arrangement. */
  x: number;
  y: number;
  mode?: Mode;
  rotation: Rotation;
  flipped: boolean;
}

export interface SavedLayout {
  /** The identity of the main display, or null. */
  primary: string | null;
  /** By `identityOf`. */
  monitors: Readonly<Record<string, SavedMonitor>>;
}

export type SavedLayouts = Readonly<Record<string, SavedLayout>>;

export function displaysPath(env: Record<string, string | undefined> = process.env): string {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(config, "dashi", "displays.json");
}

const record = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);
const position = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= FAR ? value : null);

function parseMode(value: unknown): Mode | null {
  const mode = record(value);
  const width = position(mode?.width);
  const height = position(mode?.height);
  const refreshMhz = position(mode?.refreshMhz);
  return width !== null && height !== null && refreshMhz !== null && width > 0 && height > 0 && refreshMhz > 0 ? { width, height, refreshMhz } : null;
}

function parseMonitor(value: unknown): SavedMonitor | null {
  const entry = record(value);
  const x = position(entry?.x);
  const y = position(entry?.y);
  if (!entry || x === null || y === null) return null;
  const rotation = ROTATIONS.find((candidate) => candidate === entry.rotation) ?? 0;
  const mode = entry.mode === undefined ? null : parseMode(entry.mode);
  return { enabled: entry.enabled !== false, x, y, rotation, flipped: entry.flipped === true, ...(mode ? { mode } : {}) };
}

/** The layouts in a saved file; what is not a layout is left out, and a file that is not ours has none. */
export function parseLayouts(text: string): SavedLayouts {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return {};
  }
  const layouts = record(record(root)?.layouts);
  if (!layouts) return {};
  const out: Record<string, SavedLayout> = {};
  for (const [key, value] of Object.entries(layouts).slice(0, MAX_LAYOUTS)) {
    const layout = record(value);
    const monitors = record(layout?.monitors);
    if (key.length === 0 || key.length > MAX_KEY || !layout || !monitors) continue;
    const kept: Record<string, SavedMonitor> = {};
    for (const [identity, entry] of Object.entries(monitors).slice(0, MAX_MONITORS)) {
      const monitor = parseMonitor(entry);
      if (monitor && identity.length > 0 && identity.length <= MAX_KEY) kept[identity] = monitor;
    }
    const primary = typeof layout.primary === "string" && layout.primary in kept ? layout.primary : null;
    if (Object.keys(kept).length > 0) out[key] = { primary, monitors: kept };
  }
  return out;
}

export const serializeLayouts = (layouts: SavedLayouts): string => `${JSON.stringify({ version: 1, layouts }, null, 2)}\n`;

export interface DisplayStoreOptions {
  /** The file; null keeps the layouts in memory only (tests). */
  path?: string | null;
}

export class DisplayStore {
  private layouts: SavedLayouts = {};
  private readonly path: string | null;

  constructor({ path = displaysPath() }: DisplayStoreOptions = {}) {
    this.path = path;
    if (!path) return;
    try {
      this.layouts = parseLayouts(readFileSync(path, "utf8"));
    } catch {
      // First run, or unreadable: nothing saved.
    }
  }

  get(key: string): SavedLayout | undefined {
    return this.layouts[key];
  }

  /** Remember `layout` for the set; the least recently saved sets go when there are too many. */
  set(key: string, layout: SavedLayout): void {
    const { [key]: _old, ...rest } = this.layouts;
    const kept = Object.entries(rest).slice(-(MAX_LAYOUTS - 1));
    this.layouts = { ...Object.fromEntries(kept), [key]: layout };
    this.write();
  }

  all(): SavedLayouts {
    return this.layouts;
  }

  private write(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, serializeLayouts(this.layouts), { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      console.error("dashi-shell: could not save the display arrangement:", error instanceof Error ? error.message : error);
    }
  }
}
