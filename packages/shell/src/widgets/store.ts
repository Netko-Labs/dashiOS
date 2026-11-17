/**
 * The placed widgets, in the person's order, kept in
 * `$XDG_CONFIG_HOME/dashi/widgets.json` and read back at start. Editing
 * (Add, remove, move, resize) changes them here; the area, the lock screen
 * and agents' tools read them.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { bool, type Infer, lenientList, literal, maybe, obj, optional, str } from "@dashi/shape";
import { writeTextAtomic } from "../shared/fs/index.ts";
import type { Placement, WidgetKind, WidgetSize } from "./types.ts";

const SIZE = literal("mini", "compact", "small", "strip", "wide", "tall", "large");
const PLACEMENT = obj(
  { id: str({ min: 1, max: 40 }), kind: str({ min: 1, max: 120 }), size: SIZE, mayGoOnAir: optional(bool()), showPrivateWhenLocked: optional(bool()) },
  { strict: false },
);
const FILE = obj({ widgets: lenientList(PLACEMENT, { max: 40 }) }, { strict: false });

/** What a first login shows (round five, frame 1): the Rundown, Weather and Battery side by side, Music. */
export const DEFAULT_WIDGETS: readonly Placement[] = [
  { id: "w1", kind: "rundown", size: "large" },
  { id: "w2", kind: "weather", size: "small" },
  { id: "w3", kind: "battery", size: "small" },
  { id: "w4", kind: "media", size: "wide" },
];

export const MAX_WIDGETS = 40;

export function widgetsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "dashi", "widgets.json");
}

function isKind(kind: string): kind is WidgetKind {
  return (
    kind.startsWith("ext:") || ["rundown", "clock", "world", "calendar", "weather", "battery", "system", "media", "timer", "notes", "agents"].includes(kind)
  );
}

function cleanPlacement(entry: Infer<typeof PLACEMENT>): Placement | null {
  if (!isKind(entry.kind)) return null;
  return {
    id: entry.id,
    kind: entry.kind,
    size: entry.size,
    ...(entry.mayGoOnAir === undefined ? {} : { mayGoOnAir: entry.mayGoOnAir }),
    ...(entry.showPrivateWhenLocked === undefined ? {} : { showPrivateWhenLocked: entry.showPrivateWhenLocked }),
  };
}

/** The file's widgets; the defaults when there is no file, and an empty column when it holds none. */
export function readWidgets(path: string): Placement[] {
  if (!existsSync(path)) return [...DEFAULT_WIDGETS];
  try {
    const parsed = maybe(FILE, JSON.parse(readFileSync(path, "utf8")));
    if (!parsed) return [...DEFAULT_WIDGETS];
    return parsed.widgets.map(cleanPlacement).filter((each): each is Placement => each !== null);
  } catch {
    return [...DEFAULT_WIDGETS];
  }
}

export class WidgetStore {
  private placements: Placement[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly path: string | null = widgetsPath()) {
    this.placements = path ? readWidgets(path) : [...DEFAULT_WIDGETS];
  }

  getSnapshot = (): readonly Placement[] => this.placements;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  add(kind: WidgetKind, size: WidgetSize, at = this.placements.length): Placement | null {
    if (this.placements.length >= MAX_WIDGETS) return null;
    let n = this.placements.length + 1;
    while (this.placements.some((each) => each.id === `w${n}`)) n++;
    const placement: Placement = { id: `w${n}`, kind, size };
    this.set([...this.placements.slice(0, at), placement, ...this.placements.slice(at)]);
    return placement;
  }

  remove(id: string): void {
    this.set(this.placements.filter((each) => each.id !== id));
  }

  /** Moves a widget `by` places in the order (⌥ arrows, a drag). */
  move(id: string, to: number): void {
    const from = this.placements.findIndex((each) => each.id === id);
    if (from < 0) return;
    const next = [...this.placements];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
    this.set(next);
  }

  update(id: string, change: Partial<Omit<Placement, "id" | "kind">>): void {
    this.set(this.placements.map((each) => (each.id === id ? { ...each, ...change } : each)));
  }

  private set(next: Placement[]): void {
    this.placements = next;
    if (this.path) {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeTextAtomic(this.path, `${JSON.stringify({ widgets: next }, null, 2)}\n`);
      } catch (error) {
        console.error("dashi-shell: saving the widgets failed:", error instanceof Error ? error.message : error);
      }
    }
    for (const listener of [...this.listeners]) listener();
  }
}
