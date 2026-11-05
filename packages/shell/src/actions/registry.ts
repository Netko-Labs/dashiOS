/**
 * The registry: every action from every source, by address. Sources come
 * and go at runtime (an app publishes its menus, a window closes); the
 * registry re-reads a source when it says it changed, and listeners hear of
 * it. Listing, looking up, and querying are pure reads of what the sources
 * hold now, so the launcher's keystroke never waits on one.
 *
 * `query` is plain matching (name, then keywords, then inside a word from
 * four letters on) for anyone without a ranker; the launcher's ranking
 * (match quality, then history) is its own and reads `list`.
 */

import { argsFromQuery, parseAddress } from "./address.ts";
import type { ActionDef, ActionKind, ActionSource, Args } from "./types.ts";

export interface ActionFilter {
  /** Only what this side may use: "person" keeps person and both, "agents" keeps agents and both. */
  who?: "person" | "agents";
  kind?: ActionKind;
  source?: string;
}

export const mayUse = (action: Pick<ActionDef, "who">, who: "person" | "agents"): boolean => action.who === "both" || action.who === who;

function matches(action: ActionDef, filter: ActionFilter): boolean {
  return (
    (filter.who === undefined || mayUse(action, filter.who)) &&
    (filter.kind === undefined || action.kind === filter.kind) &&
    (filter.source === undefined || action.source === filter.source)
  );
}

/** Text as it is compared: lowercase, accents gone ("Écran" finds "ecran"). */
export const fold = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** How well `action` answers `q` (folded), lower is better; null when it doesn't. */
export function matchScore(action: ActionDef, q: string): number | null {
  if (q === "") return null;
  const title = fold(action.title);
  const words = Object.values(action.keywords).flatMap((list) => list.map(fold));
  if (title === q) return 0;
  if (words.includes(q)) return 1;
  if (title.startsWith(q)) return 2;
  if (title.split(/[\s\-_.›/]+/).some((word) => word.startsWith(q))) return 3;
  if (words.some((word) => word.startsWith(q) || word.split(/\s+/).some((part) => part.startsWith(q)))) return 4;
  // Inside a word only from four letters on: "ter" must not find "Battery".
  if (q.length >= 4 && (title.includes(q) || words.some((word) => word.includes(q)))) return 5;
  return null;
}

export class ActionRegistry {
  private readonly sources: ActionSource[] = [];
  private readonly unsubscribes = new Map<ActionSource, () => void>();
  private byAddress: Map<string, ActionDef> | null = null;
  private all: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();

  /** Adds a source after the others (an address it repeats stays the earlier source's); returns what takes it away again. */
  add(source: ActionSource): () => void {
    if (this.sources.some((each) => each.id === source.id)) throw new Error(`an action source called ${source.id} is already added`);
    this.sources.push(source);
    const off = source.subscribe?.(() => this.changed());
    if (off) this.unsubscribes.set(source, off);
    this.changed();
    return () => this.remove(source);
  }

  private remove(source: ActionSource): void {
    const index = this.sources.indexOf(source);
    if (index < 0) return;
    this.sources.splice(index, 1);
    this.unsubscribes.get(source)?.();
    this.unsubscribes.delete(source);
    this.changed();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    this.byAddress = null;
    for (const listener of this.listeners) listener();
  }

  private index(): Map<string, ActionDef> {
    if (this.byAddress) return this.byAddress;
    const index = new Map<string, ActionDef>();
    for (const source of this.sources) {
      for (const action of source.actions()) if (!index.has(action.address)) index.set(action.address, action);
    }
    this.byAddress = index;
    this.all = [...index.values()];
    return index;
  }

  /** Every action, in source order, that `filter` keeps. */
  list(filter: ActionFilter = {}): ActionDef[] {
    this.index();
    return this.all.filter((action) => matches(action, filter));
  }

  get(address: string): ActionDef | undefined {
    return this.index().get(address);
  }

  /** A link or a typed address: its action and its arguments read by that action's schema. */
  resolve(text: string): { action: ActionDef; args: Args } | { error: string } {
    const parsed = parseAddress(text);
    if (!parsed) return { error: "That is not a dashi:// address." };
    const action = this.get(parsed.address);
    if (!action) return { error: `Nothing is at ${parsed.address}.` };
    return { action, args: argsFromQuery(parsed.query, action.properties) };
  }

  /** The actions `text` finds, best first; ties keep source order. */
  query(text: string, filter: ActionFilter = {}, limit = 20): ActionDef[] {
    const q = fold(text);
    return this.list(filter)
      .map((action, order) => ({ action, order, score: matchScore(action, q) }))
      .filter((hit): hit is { action: ActionDef; order: number; score: number } => hit.score !== null)
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .slice(0, limit)
      .map(({ action }) => action);
  }

  /** Ask every source that can to read again (the launcher opening). */
  async refresh(): Promise<void> {
    await Promise.all(this.sources.map((source) => source.refresh?.().catch((error) => console.error(`dashi-shell: actions from ${source.id}:`, error))));
  }

  close(): void {
    for (const off of this.unsubscribes.values()) off();
    this.unsubscribes.clear();
    this.sources.length = 0;
    this.changed();
  }
}

/** A source that never changes (the agents' tools, Dashi's own commands). */
export function fixedSource(id: string, actions: readonly ActionDef[]): ActionSource {
  return { id, actions: () => actions };
}

/** A source whose actions are set from outside (`set`), telling the registry each time. */
export class MutableSource implements ActionSource {
  private current: readonly ActionDef[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(readonly id: string) {}

  actions = (): readonly ActionDef[] => this.current;

  set(actions: readonly ActionDef[]): void {
    this.current = actions;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
