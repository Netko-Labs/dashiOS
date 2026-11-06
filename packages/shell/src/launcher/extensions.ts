/**
 * What comes into the launcher from outside Dashi (docs/betterments.html,
 * "Applets contribute commands" and "Per-source time budgets"): the GNOME
 * search providers' results below every instant row, and what an applet's
 * or a script's command asks for after it ran (`Outcome.show`):
 *
 * - its answer, as the top row (Return copies it);
 * - rows to pick from (an applet's pick command): the field asks the applet
 *   as the person types, a chip names the command, Esc goes back;
 * - a view: the applet draws its answer itself where the rows were;
 * - the words it needs first (a command with arguments): one at a time, in
 *   the field, the chip naming the command.
 *
 * Every outside source is asked with a sequence number and given 80 ms
 * (budget.ts); one late says so on its head ("Characters · slow") and its
 * rows go below the rest, and one late three times isn't asked again this
 * session. Nothing here moves a row that is already drawn.
 */

import { useEffect, useRef, useState } from "react";
import type { ActionDef, Args, Outcome, PickRow, Shown } from "../actions/types.ts";
import { realTimers, type SlowSnapshot, type SlowSource, SlowSources, type Timers } from "./budget.ts";
import { argRow, outsideIcon, pickSection, resultRow, type SlowRow, slowSections, viewRows } from "./extension-rows.ts";
import { FIELD } from "./field.tsx";
import type { LauncherItem } from "./items.ts";
import { ROW_HEIGHT } from "./row-view.tsx";
import type { RowIcon, Section } from "./rows.ts";

/** Below this many letters the search providers aren't asked (as files aren't). */
export const PROVIDER_MIN_QUERY = 2;

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

type Scope =
  | { kind: "pick"; shown: Extract<Shown, { kind: "pick" }>; from: string; icon: RowIcon; address: string }
  | { kind: "view"; shown: Extract<Shown, { kind: "view" }>; from: string }
  | { kind: "args"; action: ActionDef; names: string[]; args: Args; from: string; icon: RowIcon };

export interface Extensions {
  /** The list with what came from outside: in a scope, the scope's rows alone. */
  sections(base: Section[]): Section[];
  /** The chip and the placeholder in a scope. */
  chip?: { title: string; icon?: RowIcon };
  placeholder?: string;
  /** Before a row runs: a command that needs words first asks for them, and true says the launcher waits. */
  intercept(item: LauncherItem): boolean;
  /** After a run: what it asked to show is shown, and true says the launcher stays. */
  shown(outcome: Outcome): boolean;
  /** Return in a scope that takes it (the words for a command). */
  submit(): boolean;
  /** Esc: leave the scope first. */
  escape(): boolean;
}

/** The panel's measures a view is placed by; `field` and `row` at the text size (measures.ts), else text size 1's. */
export interface ViewMeasures {
  width: number;
  padding: number;
  field?: number;
  row?: number;
}

/** Where a view goes in the panel: under the field, inside the list's padding (launcher.tsx's measures). */
export function viewFrame(rows: number, measures: ViewMeasures): { x: number; y: number; width: number; height: number } {
  const border = 1;
  return {
    x: border + measures.padding,
    y: border + (measures.field ?? FIELD.height) + border + measures.padding,
    width: measures.width - 2 * (border + measures.padding),
    height: rows * (measures.row ?? ROW_HEIGHT),
  };
}

/** One argument's words as its schema wants them; null when they can't be. */
export function readArg(text: string, schema: unknown): string | number | boolean | null {
  const type = typeof schema === "object" && schema !== null ? (schema as { type?: unknown }).type : undefined;
  const trimmed = text.trim();
  if (type === "number" || type === "integer") return /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;
  if (type === "boolean") return /^(true|yes|on)$/i.test(trimmed) ? true : /^(false|no|off)$/i.test(trimmed) ? false : null;
  return trimmed;
}

const argTitle = (action: ActionDef, name: string): string => {
  const schema = action.properties[name];
  const description = typeof schema === "object" && schema !== null ? (schema as { description?: unknown }).description : undefined;
  return typeof description === "string" && description !== "" ? description : name;
};

export function useExtensions(input: ExtensionsInput, measures: ViewMeasures): Extensions {
  const { session, query, searching } = input;
  const [scope, setScope] = useState<Scope | null>(null);
  const [result, setResult] = useState<{ query: string; text: string; from: string; icon: RowIcon } | null>(null);
  const [found, setFound] = useState<SlowSnapshot<SlowRow> | null>(null);
  const [picked, setPicked] = useState<SlowSnapshot<PickRow> | null>(null);
  const last = useRef<LauncherItem | null>(null);
  // What the field holds now: the words typed, or what the hook just put there (a run's answer is for those).
  const typed = useRef(query);
  typed.current = query;
  const latest = useRef(input);
  latest.current = {
    ...input,
    restart: (next) => {
      typed.current = next;
      input.restart(next);
    },
  };
  // A run's answer comes after the render that started it: the handlers read the scope as it is now.
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const enter = (next: Scope | null): void => {
    scopeNow.current = next;
    setScope(next);
  };
  const text = query.trim();

  // The providers, for what is typed in the search.
  useEffect(() => {
    if (!session || scope || !searching) return;
    const slow = session.searchSources(setFound);
    if (!slow) return;
    if (text.length < PROVIDER_MIN_QUERY) {
      slow.stop();
      setFound(null);
      return;
    }
    slow.start(text);
    return () => slow.stop();
  }, [session, scope, searching, text]);

  // A pick command's rows, for what is typed in its scope.
  useEffect(() => {
    if (!session || scope?.kind !== "pick") return;
    const slow = session.pickSources(scope.address, scope.from, scope.shown.ask, setPicked);
    if (slow.isDropped(scope.address)) return;
    slow.start(text);
    return () => slow.stop();
  }, [session, scope, text]);

  // A view: placed once its room is drawn, closed when the scope goes (or the launcher does).
  useEffect(() => {
    if (scope?.kind !== "view") return;
    const view = scope.shown;
    view.onClose(() => setScope((now) => (now?.kind === "view" && now.shown === view ? null : now)));
    view.place(viewFrame(viewRows(view.height, measures.row), measures));
    return () => view.close();
  }, [scope, measures]);

  const fromOf = (item: LauncherItem | null): { from: string; icon: RowIcon } => {
    const action = item?.action;
    return { from: action?.from ?? "Command", icon: outsideIcon(action?.icon, action?.source ?? "") };
  };

  return {
    sections(base) {
      if (scope?.kind === "pick") {
        const dropped = session?.pickSources(scope.address, scope.from, scope.shown.ask, setPicked).isDropped(scope.address) ?? false;
        return [
          pickSection(picked && picked.query === text ? picked : null, {
            title: scope.shown.title,
            from: scope.from,
            icon: scope.icon,
            address: scope.address,
            isDropped: dropped,
            choose: scope.shown.choose,
          }),
        ];
      }
      if (scope?.kind === "view") return [{ id: "view", rows: [], reserved: viewRows(scope.shown.height, measures.row) }];
      if (scope?.kind === "args") {
        const name = scope.names[0] ?? "";
        return [{ id: "arg", rows: [argRow(argTitle(scope.action, name), query, scope.from, scope.icon, scope.names.length <= 1)] }];
      }
      const top: Section[] = result && result.query === query ? [{ id: "result", rows: [resultRow(result.text, result.from, result.icon)] }] : [];
      const slow = searching && text.length >= PROVIDER_MIN_QUERY ? slowSections(found && found.query === text ? found : null) : [];
      // Results from a provider are something found: "Nothing called …" would be wrong above them.
      const rest = slow.length > 0 ? base.filter((section) => section.id !== "nothing") : base;
      return [...top, ...rest, ...slow];
    },
    ...(scope
      ? {
          chip: { title: scope.kind === "args" ? scope.action.title : scope.shown.title, ...(scope.kind === "view" ? {} : { icon: scope.icon }) },
          placeholder: scope.kind === "pick" ? `Search ${scope.from}` : scope.kind === "args" ? argTitle(scope.action, scope.names[0] ?? "") : "Esc goes back",
        }
      : {}),
    intercept(item) {
      // The row a pick offers runs as it is; anything else is what later answers are from.
      if (scopeNow.current?.kind !== "pick") last.current = item;
      const action = item.action;
      if (!action || action.from === undefined || scopeNow.current?.kind === "args") return false;
      const names = Object.keys(action.properties);
      if (names.length === 0) return false;
      const { from, icon } = fromOf(item);
      enter({ kind: "args", action, names, args: {}, from, icon });
      latest.current.restart("");
      return true;
    },
    shown(outcome) {
      // Only the search shows them (a link's action, run from its own list, closes as any run does).
      if (!outcome.ok || !outcome.show || !latest.current.searching) return false;
      const show = outcome.show;
      const now = scopeNow.current;
      const { from, icon } = now?.kind === "pick" ? { from: now.from, icon: now.icon } : fromOf(last.current);
      setPicked(null);
      if (show.kind === "text") {
        // The answer is the top row for what is in the field once it is shown.
        const next = now ? "" : typed.current;
        enter(null);
        setResult({ query: next, text: show.text, from, icon });
        if (now) latest.current.restart("");
        latest.current.select("result");
        return true;
      }
      const address = last.current?.action?.address ?? "dashi://search/command";
      setResult(null);
      enter(show.kind === "pick" ? { kind: "pick", shown: show, from, icon, address } : { kind: "view", shown: show, from });
      latest.current.restart("");
      return true;
    },
    submit() {
      const now = scopeNow.current;
      if (now?.kind !== "args") return false;
      const [name, ...rest] = now.names;
      if (name === undefined) return false;
      const value = readArg(typed.current, now.action.properties[name]);
      const required = (now.action.required ?? []).includes(name);
      if (value === null || (value === "" && required)) return true;
      const args = value === "" ? now.args : { ...now.args, [name]: value };
      latest.current.restart("");
      if (rest.length > 0) {
        enter({ ...now, names: rest, args });
        return true;
      }
      enter(null);
      latest.current.run(now.action, args);
      return true;
    },
    escape() {
      if (scopeNow.current) {
        enter(null);
        setPicked(null);
        latest.current.restart("");
        return true;
      }
      if (result) setResult(null);
      return false;
    },
  };
}
