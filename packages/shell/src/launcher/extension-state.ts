/**
 * What the launcher's extensions keep (extensions.ts): across opens, the
 * providers' slow sources and each pick command's, so that a source that was
 * late three times stays dropped (the launcher is mounted afresh on every
 * open; the session is not); within one open, the scope an outside command
 * opened (its pick, its view, its words) and the steps in and out of it.
 */

import type { ActionDef, Args, Outcome, PickRow, Shown } from "../actions/types.ts";
import { realTimers, type SlowSnapshot, type SlowSource, SlowSources, type Timers } from "./budget.ts";
import { outsideIcon, type SlowRow } from "./extension-rows.ts";
import type { LauncherItem } from "./items.ts";
import type { RowIcon } from "./rows.ts";

/**
 * What lasts the session: the providers (and how often each was late), and
 * each pick command's lateness, by its address. The launcher is mounted
 * afresh on every open; this is not.
 */
export class ExtensionSession {
  private search: { sources: readonly SlowSource<SlowRow>[]; slow: SlowSources<SlowRow> } | null = null;
  private readonly picks = new Map<string, { slow: SlowSources<PickRow>; ask: (query: string) => Promise<readonly PickRow[]> }>();
  private searchListener: ((snapshot: SlowSnapshot<SlowRow>) => void) | null = null;
  private pickListener: ((snapshot: SlowSnapshot<PickRow>) => void) | null = null;

  constructor(
    private readonly providers: () => readonly SlowSource<SlowRow>[],
    private readonly timers: Timers = realTimers,
  ) {}

  /** The providers' slow sources, the same while the providers are (so their misses count across opens). */
  searchSources(listener: ((snapshot: SlowSnapshot<SlowRow>) => void) | null): SlowSources<SlowRow> | null {
    this.searchListener = listener;
    const sources = this.providers();
    if (sources.length === 0) return null;
    if (this.search?.sources !== sources) {
      this.search?.slow.stop();
      this.search = { sources, slow: new SlowSources(sources, (snapshot) => this.searchListener?.(snapshot), this.timers) };
    }
    return this.search.slow;
  }

  /** A pick command's one slow source, by its address: `ask` is this run's, the misses the session's. */
  pickSources(
    address: string,
    label: string,
    ask: (query: string) => Promise<readonly PickRow[]>,
    listener: (snapshot: SlowSnapshot<PickRow>) => void,
  ): SlowSources<PickRow> {
    this.pickListener = listener;
    const known = this.picks.get(address);
    if (known) {
      known.ask = ask;
      return known.slow;
    }
    const entry: { slow: SlowSources<PickRow>; ask: (query: string) => Promise<readonly PickRow[]> } = {
      ask,
      slow: new SlowSources<PickRow>(
        [{ id: address, label, ask: (query: string): Promise<readonly PickRow[]> => entry.ask(query) }],
        (snapshot) => this.pickListener?.(snapshot),
        this.timers,
      ),
    };
    this.picks.set(address, entry);
    return entry.slow;
  }
}

/** What the launcher gives the hook: what is typed, and how to change it. */
export interface ExtensionsInput {
  session: ExtensionSession | undefined;
  query: string;
  /** The launcher is in its search (not the action list, an alias, a link's action). */
  searching: boolean;
  /** Put these words in the field (and select the first row). */
  restart(next: string): void;
  select(id: string): void;
  /** Run an action for the person (the launcher's host), and take what it came to as any run's. */
  run(action: ActionDef, args: Args): void;
}

export type Scope =
  | { kind: "pick"; shown: Extract<Shown, { kind: "pick" }>; from: string; icon: RowIcon; address: string }
  | { kind: "view"; shown: Extract<Shown, { kind: "view" }>; from: string }
  | { kind: "args"; action: ActionDef; names: string[]; args: Args; from: string; icon: RowIcon };

/** One argument's words as its schema wants them; null when they can't be. */
export function readArg(text: string, schema: unknown): string | number | boolean | null {
  const type = typeof schema === "object" && schema !== null ? (schema as { type?: unknown }).type : undefined;
  const trimmed = text.trim();
  if (type === "number" || type === "integer") return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
  if (type === "boolean") return /^(true|yes|on)$/i.test(trimmed) ? true : /^(false|no|off)$/i.test(trimmed) ? false : null;
  return trimmed;
}

export const argTitle = (action: ActionDef, name: string): string => {
  const schema = action.properties[name];
  const description = typeof schema === "object" && schema !== null ? (schema as { description?: unknown }).description : undefined;
  return typeof description === "string" && description !== "" ? description : name;
};

/** The answer a run showed as text: the top row for `query`, while that is what the field holds. */
export interface Result {
  query: string;
  text: string;
  from: string;
  icon: RowIcon;
}

/** What the handlers share: the refs they read as things are now, and the setters of the hook's state. */
export interface Held {
  /** The launcher's input as of the last render, `restart` also noting what the field now holds. */
  latest: { current: ExtensionsInput };
  /** What the field holds now: the words typed, or what the hook just put there (a run's answer is for those). */
  typed: { current: string };
  /** The scope as it is now: a run's answer comes after the render that started it. */
  scopeNow: { current: Scope | null };
  /** The row that last ran outside a pick: what later answers are from. */
  last: { current: LauncherItem | null };
  enter(next: Scope | null): void;
  setResult(next: Result | null): void;
  setPicked(next: SlowSnapshot<PickRow> | null): void;
}

export const fromOf = (item: LauncherItem | null): { from: string; icon: RowIcon } => {
  const action = item?.action;
  return { from: action?.from ?? "Command", icon: outsideIcon(action?.icon, action?.source ?? "") };
};

/** Before a row runs: a command that needs words first asks for them, and true says the launcher waits. */
export function interceptRun(held: Held, item: LauncherItem): boolean {
  // The row a pick offers runs as it is; anything else is what later answers are from.
  if (held.scopeNow.current?.kind !== "pick") held.last.current = item;
  const action = item.action;
  if (!action || action.from === undefined || held.scopeNow.current?.kind === "args") return false;
  const names = Object.keys(action.properties);
  if (names.length === 0) return false;
  const { from, icon } = fromOf(item);
  held.enter({ kind: "args", action, names, args: {}, from, icon });
  held.latest.current.restart("");
  return true;
}

/** After a run: what it asked to show is shown, and true says the launcher stays. */
export function showOutcome(held: Held, outcome: Outcome): boolean {
  // Only the search shows them (a link's action, run from its own list, closes as any run does).
  if (!outcome.ok || !outcome.show || !held.latest.current.searching) return false;
  const show = outcome.show;
  const now = held.scopeNow.current;
  const { from, icon } = now?.kind === "pick" ? { from: now.from, icon: now.icon } : fromOf(held.last.current);
  held.setPicked(null);
  if (show.kind === "text") {
    // The answer is the top row for what is in the field once it is shown.
    const next = now ? "" : held.typed.current;
    held.enter(null);
    held.setResult({ query: next, text: show.text, from, icon });
    if (now) held.latest.current.restart("");
    held.latest.current.select("result");
    return true;
  }
  const address = held.last.current?.action?.address ?? "dashi://search/command";
  held.setResult(null);
  held.enter(show.kind === "pick" ? { kind: "pick", shown: show, from, icon, address } : { kind: "view", shown: show, from });
  held.latest.current.restart("");
  return true;
}

/** Return in a scope that takes it: the words typed are one argument, and the last one runs the command. */
export function submitArg(held: Held): boolean {
  const now = held.scopeNow.current;
  if (now?.kind !== "args") return false;
  const [name, ...rest] = now.names;
  if (name === undefined) return false;
  const value = readArg(held.typed.current, now.action.properties[name]);
  const required = (now.action.required ?? []).includes(name);
  if (value === null || (value === "" && required)) return true;
  const args = value === "" ? now.args : { ...now.args, [name]: value };
  held.latest.current.restart("");
  if (rest.length > 0) {
    held.enter({ ...now, names: rest, args });
    return true;
  }
  held.enter(null);
  held.latest.current.run(now.action, args);
  return true;
}

/** Esc: leave the scope first, else drop the answer shown (and let the launcher go). */
export function escapeScope(held: Held, result: Result | null): boolean {
  if (held.scopeNow.current) {
    held.enter(null);
    held.setPicked(null);
    held.latest.current.restart("");
    return true;
  }
  if (result) held.setResult(null);
  return false;
}
