/**
 * The person's Control Center layout, kept per machine in
 * `$XDG_STATE_HOME/dashi/control-center-layout.json` under the machine's id
 * (`/etc/machine-id`): a home folder shared between two laptops keeps a
 * layout for each. The panel and Settings › Control Center edit it through
 * the same store; nothing saved yet is the default layout.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT } from "./catalog.ts";
import { type Layout, parseLayout } from "./layout.ts";

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

/** The machines' layouts in the file; anything unreadable is left out. */
export function parseLayouts(text: string): Map<string, Layout> {
  const out = new Map<string, Layout>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  const machines = typeof value === "object" && value !== null ? (value as { machines?: unknown }).machines : null;
  if (typeof machines !== "object" || machines === null) return out;
  for (const [id, entry] of Object.entries(machines)) {
    const layout = parseLayout(entry);
    if (layout && /^[0-9a-z]{1,64}$/.test(id)) out.set(id, layout);
  }
  return out;
}

export class LayoutStore {
  private layout: Layout;
  private readonly listeners = new Set<() => void>();

  /** `path` null keeps it in memory (tests, previews). */
  constructor(
    private readonly path: string | null = layoutPath(),
    private readonly machine: string = machineId(),
  ) {
    this.layout = this.read().get(machine) ?? DEFAULT_LAYOUT;
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

  private read(): Map<string, Layout> {
    if (!this.path) return new Map();
    try {
      return parseLayouts(readFileSync(this.path, "utf8"));
    } catch {
      return new Map();
    }
  }

  private save(): void {
    if (!this.path) return;
    const all = this.read();
    all.set(this.machine, this.layout);
    const machines = Object.fromEntries([...all].map(([id, layout]) => [id, { items: layout.map(({ id: item, size }) => ({ id: item, size })) }]));
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
