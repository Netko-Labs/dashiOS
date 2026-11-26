/**
 * The person's Control Center layout, kept per machine in
 * `$XDG_STATE_HOME/dashi/control-center-layout.json` under the machine's id
 * (`/etc/machine-id`): a home folder shared between two laptops keeps a
 * layout for each. The panel and Settings › Control Center edit it through
 * the same store; nothing saved yet is the default layout. Each layout keeps
 * the tiles it knew (`known`): a tile Dashi adds later joins it once, in its
 * default place (`withNewTiles`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT } from "./catalog.ts";
import { KNOWN_BEFORE_0_10, type Layout, parseLayout, withNewTiles } from "./layout.ts";

export function layoutPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "control-center-layout.json");
}

/** This machine's id, or "this" when it can't be read (a container). */
export function machineId(read: (path: string) => string = (path) => readFileSync(path, "utf8")): string {
  try {
    const id = read("/etc/machine-id").trim();
    return /^[0-9a-f]{32}$/.test(id) ? id : "this";
  } catch {
    return "this";
  }
}

/** A machine's saved layout, and the tiles it knew (none said: 0.9's, KNOWN_BEFORE_0_10). */
interface Saved {
  layout: Layout;
  known: readonly string[] | null;
}

const knownOf = (value: unknown): readonly string[] | null =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, 64) : null;

/** The machines' saved layouts in the file, with what each knew; anything unreadable is left out. */
function parseSaved(text: string): Map<string, Saved> {
  const out = new Map<string, Saved>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  const machines = isRecord(value) ? value.machines : null;
  if (!isRecord(machines)) return out;
  for (const [id, entry] of Object.entries(machines)) {
    const layout = parseLayout(entry);
    if (layout && /^[0-9a-z]{1,64}$/.test(id)) out.set(id, { layout, known: isRecord(entry) ? knownOf(entry.known) : null });
  }
  return out;
}

/** The machines' layouts in the file; anything unreadable is left out. */
export function parseLayouts(text: string): Map<string, Layout> {
  return new Map([...parseSaved(text)].map(([id, saved]) => [id, saved.layout]));
}

/** What a layout knows once saved now: what it knew and every tile of the default. */
const knownNow = (known: readonly string[] | null): string[] =>
  [...new Set([...(known ?? KNOWN_BEFORE_0_10), ...DEFAULT_LAYOUT.map((tile) => tile.id)])].slice(0, 64);

export class LayoutStore {
  private layout: Layout;
  private readonly listeners = new Set<() => void>();

  /** `path` null keeps it in memory (tests, previews). */
  constructor(
    private readonly path: string | null = layoutPath(),
    private readonly machine: string = machineId(),
  ) {
    const saved = this.read().get(machine);
    this.layout = saved ? withNewTiles(saved.layout, new Set(saved.known ?? KNOWN_BEFORE_0_10), DEFAULT_LAYOUT) : DEFAULT_LAYOUT;
    // A layout given its new tiles, or saved before it said what it knew, is saved now: once.
    if (saved && (this.layout !== saved.layout || saved.known === null)) this.save();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Layout => this.layout;

  set(layout: Layout): void {
    if (JSON.stringify(layout) === JSON.stringify(this.layout)) return;
    this.layout = layout;
    this.save();
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.set(DEFAULT_LAYOUT);
  }

  private read(): Map<string, Saved> {
    if (!this.path) return new Map();
    try {
      return parseSaved(readFileSync(this.path, "utf8"));
    } catch {
      return new Map();
    }
  }

  private save(): void {
    if (!this.path) return;
    const all = this.read();
    all.set(this.machine, { layout: this.layout, known: knownNow(all.get(this.machine)?.known ?? null) });
    const machines = Object.fromEntries(
      [...all].map(([id, { layout, known }]) => [id, { items: layout.map(({ id: item, size }) => ({ id: item, size })), ...(known ? { known } : {}) }]),
    );
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, `${JSON.stringify({ machines }, null, 1)}\n`);
    } catch (error) {
      console.error("dashi-shell: could not save Control Center's layout:", error);
    }
  }
}

export function useLayout(store: LayoutStore): Layout {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
