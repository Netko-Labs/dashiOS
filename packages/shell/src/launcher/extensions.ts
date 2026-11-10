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
import type { Outcome, PickRow } from "../actions/index.ts";
import type { SlowSnapshot } from "./budget.ts";
import { argRow, pickSection, resultRow, type SlowRow, slowSections, viewRows } from "./extension-rows.ts";
import {
  argTitle,
  type ExtensionSession,
  type ExtensionsInput,
  escapeScope,
  type Held,
  interceptRun,
  type Result,
  type Scope,
  showOutcome,
  submitArg,
} from "./extension-state.ts";
import { FIELD } from "./field.tsx";
import type { LauncherItem } from "./items.ts";
import { ROW_HEIGHT } from "./row-view.tsx";
import type { RowIcon, Section } from "./rows.ts";

export { ExtensionSession, type ExtensionsInput, readArg } from "./extension-state.ts";

/** Below this many letters the search providers aren't asked (as files aren't). */
export const PROVIDER_MIN_QUERY = 2;

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

/** What the sections are drawn from. */
interface Drawn {
  session: ExtensionSession | undefined;
  scope: Scope | null;
  query: string;
  text: string;
  searching: boolean;
  result: Result | null;
  found: SlowSnapshot<SlowRow> | null;
  picked: SlowSnapshot<PickRow> | null;
  measures: ViewMeasures;
  setPicked(next: SlowSnapshot<PickRow> | null): void;
}

/** The providers, asked for what is typed in the search. */
function useProviderRows(session: ExtensionSession | undefined, active: boolean, text: string, setFound: (next: SlowSnapshot<SlowRow> | null) => void): void {
  useEffect(() => {
    if (!session || !active) return;
    const slow = session.searchSources(setFound);
    if (!slow) return;
    if (text.length < PROVIDER_MIN_QUERY) {
      slow.stop();
      setFound(null);
      return;
    }
    slow.start(text);
    return () => slow.stop();
  }, [session, active, text, setFound]);
}

/** A pick command's rows, for what is typed in its scope. */
function usePickRows(session: ExtensionSession | undefined, scope: Scope | null, text: string, setPicked: (next: SlowSnapshot<PickRow> | null) => void): void {
  useEffect(() => {
    if (!session || scope?.kind !== "pick") return;
    const slow = session.pickSources(scope.address, scope.from, scope.shown.ask, setPicked);
    if (slow.isDropped(scope.address)) return;
    slow.start(text);
    return () => slow.stop();
  }, [session, scope, text, setPicked]);
}

/** A view: placed once its room is drawn, closed when the scope goes (or the launcher does). */
function useViewPlacement(scope: Scope | null, measures: ViewMeasures, setScope: (next: (now: Scope | null) => Scope | null) => void): void {
  useEffect(() => {
    if (scope?.kind !== "view") return;
    const view = scope.shown;
    view.onClose(() => setScope((now) => (now?.kind === "view" && now.shown === view ? null : now)));
    view.place(viewFrame(viewRows(view.height, measures.row), measures));
    return () => view.close();
  }, [scope, measures, setScope]);
}

/** The list with what came from outside: in a scope, the scope's rows alone. */
function sectionsOf(base: Section[], drawn: Drawn): Section[] {
  const { session, scope, query, text, searching, result, found, picked, measures } = drawn;
  if (scope?.kind === "pick") {
    const dropped = session?.pickSources(scope.address, scope.from, scope.shown.ask, drawn.setPicked).isDropped(scope.address) ?? false;
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
  // A provider's results land below everything already drawn, "Nothing called …" and its rows included:
  // what is on top (and selected) never moves when they arrive.
  return [...top, ...base, ...slow];
}

/** The chip and the placeholder in a scope; nothing outside one. */
function scopeLabels(scope: Scope | null): Pick<Extensions, "chip" | "placeholder"> {
  if (!scope) return {};
  return {
    chip: { title: scope.kind === "args" ? scope.action.title : scope.shown.title, ...(scope.kind === "view" ? {} : { icon: scope.icon }) },
    placeholder: scope.kind === "pick" ? `Search ${scope.from}` : scope.kind === "args" ? argTitle(scope.action, scope.names[0] ?? "") : "Esc goes back",
  };
}

export function useExtensions(input: ExtensionsInput, measures: ViewMeasures): Extensions {
  const { session, query, searching } = input;
  const [scope, setScope] = useState<Scope | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [found, setFound] = useState<SlowSnapshot<SlowRow> | null>(null);
  const [picked, setPicked] = useState<SlowSnapshot<PickRow> | null>(null);
  const last = useRef<LauncherItem | null>(null);
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
  const scopeNow = useRef(scope);
  scopeNow.current = scope;
  const enter = (next: Scope | null): void => {
    scopeNow.current = next;
    setScope(next);
  };
  const text = query.trim();
  const held: Held = { latest, typed, scopeNow, last, enter, setResult, setPicked };

  useProviderRows(session, !scope && searching, text, setFound);
  usePickRows(session, scope, text, setPicked);
  useViewPlacement(scope, measures, setScope);

  return {
    sections: (base) => sectionsOf(base, { session, scope, query, text, searching, result, found, picked, measures, setPicked }),
    ...scopeLabels(scope),
    intercept: (item) => interceptRun(held, item),
    shown: (outcome) => showOutcome(held, outcome),
    submit: () => submitArg(held),
    escape: () => escapeScope(held, result),
  };
}
