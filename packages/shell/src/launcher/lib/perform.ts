/**
 * What a row's verb does once chosen (launcher.tsx): open, focus, run, copy,
 * a window's and a file's verbs, and giving an alias or a key. Each group is a
 * step of its own; `perform` picks one by the effect's kind.
 */

import type { Outcome } from "../../actions/index.ts";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import type { LauncherScope, ScopeResult } from "../types.ts";
import type { Effect } from "../verbs.ts";
import type { AgentAct } from "./agents/acts.ts";
import type { Mode } from "./mode.ts";
import type { LauncherState, Search } from "./state.ts";

/** What performing reaches: the props, the state, the search, and the launcher's own steps. */
export interface PerformDeps {
  props: LauncherProps;
  s: LauncherState;
  search: Search;
  /** What the ranking learns: this row was chosen for what was typed (or opened, with nothing typed). */
  learn(row: Row | undefined): void;
  enterScope(next: LauncherScope | null): void;
  scopeDone(result: ScopeResult, stay: boolean): void;
  backToSearch(): void;
  /** Agents from the launcher's own acts; false for the rest. */
  handoffAct(act: AgentAct): boolean;
  agentAct(act: AgentAct): void;
}

type Of<Kind extends Effect["kind"]> = Extract<Effect, { kind: Kind }>;

/** Does `effect` for `row`; `stay` (⇧↩) keeps the launcher open. */
export function perform(effect: Effect, row: Row | undefined, stay: boolean, d: PerformDeps): void {
  switch (effect.kind) {
    case "open":
    case "focus":
    case "run":
    case "scope":
    case "run-args":
    case "reveal":
    case "toggle":
    case "open-file":
      return performOpen(effect, row, stay, d);
    case "copy":
    case "type":
    case "search-files":
    case "find-software":
    case "all-apps":
    case "agent":
      return performInPlace(effect, row, d);
    case "new-window":
    case "bring-here":
    case "minimize":
    case "close":
    case "quit":
    case "show-in-files":
    case "trash":
    case "pin":
      return performOnThing(effect, row, stay, d);
    case "alias":
    case "unalias":
    case "shortcut":
    case "unshortcut":
    case "forget":
    case "forget-all":
      return performEdit(effect, d);
  }
}

/** Opening and running: an app, a window, a registry action, a scope's verb, a setting's switch, a file. */
function performOpen(
  effect: Of<"open" | "focus" | "run" | "scope" | "run-args" | "reveal" | "toggle" | "open-file">,
  row: Row | undefined,
  stay: boolean,
  d: PerformDeps,
): void {
  const { props, s, search, learn } = d;
  const host = props.host;
  const runOf = (promise: Promise<Outcome> | undefined) => void promise?.then((outcome) => search.ran(outcome, stay));
  switch (effect.kind) {
    case "open":
      learn(row);
      if (!props.onOpen(effect.entry, stay)) {
        s.setFailed(effect.entry);
        s.setHeld(`failed:${effect.entry.id}`);
      }
      return;
    case "focus":
      learn(row);
      void host?.focus(effect.window).then(() => search.finish(stay));
      return;
    case "run": {
      learn(row);
      const entering = props.scopes?.find((each) => each.address === effect.item.action?.address);
      if (entering) return d.enterScope(entering);
      if (search.ext.intercept(effect.item)) return;
      if (effect.item.action) runOf(host?.run(effect.item.action));
      return;
    }
    case "scope":
      if (s.scope) void Promise.resolve(s.scope.run(effect.verb, row, search.text)).then((result) => d.scopeDone(result, stay));
      return;
    case "run-args":
      runOf(host?.run(effect.action, effect.args));
      return;
    case "reveal":
      learn(row);
      if (effect.item.action?.place) host?.reveal(effect.item.action.place);
      search.finish(stay);
      return;
    case "toggle":
      if (effect.item.action) void host?.run(effect.item.action).then((outcome) => !outcome.ok && search.say(outcome));
      return;
    case "open-file":
      learn(row);
      return props.onOpenFile?.(effect.file, stay);
  }
}

/** What stays in the launcher: copying, new words, looking elsewhere, All apps, the agents' acts. */
function performInPlace(effect: Of<"copy" | "type" | "search-files" | "find-software" | "all-apps" | "agent">, row: Row | undefined, d: PerformDeps): void {
  const { props, s, search } = d;
  switch (effect.kind) {
    case "copy": {
      const isAnswer = row?.id === "answer";
      if (!props.copy) return isAnswer ? s.setCopied({ query: search.text, ok: false }) : search.sayDone("Couldn't copy", false);
      void props.copy(effect.text).then((ok) => (isAnswer ? s.setCopied({ query: search.text, ok }) : search.sayDone(ok ? "Copied" : "Couldn't copy", ok)));
      if (s.mode.kind !== "search") d.backToSearch();
      return;
    }
    case "type":
      return search.restart(effect.query);
    case "search-files":
      return props.onSearchFiles?.(effect.query);
    case "find-software":
      return props.onFindSoftware?.(effect.query);
    case "all-apps":
      s.offset.current = 0;
      s.setAllApps(true);
      s.setHeld(null);
      return;
    case "agent":
      if (d.handoffAct(effect.act)) return;
      return d.agentAct(effect.act);
  }
}

/** A row's other verbs on its app, window or file. */
function performOnThing(
  effect: Of<"new-window" | "bring-here" | "minimize" | "close" | "quit" | "show-in-files" | "trash" | "pin">,
  row: Row | undefined,
  stay: boolean,
  d: PerformDeps,
): void {
  const { props, search, learn, backToSearch } = d;
  const { host } = props;
  const { finish, sayDone } = search;
  switch (effect.kind) {
    case "new-window":
      learn(row);
      if (host?.newWindow(effect.entry)) finish(stay);
      else sayDone(`Couldn't open a new ${effect.entry.name} window`, false);
      return;
    case "bring-here":
      void host?.bringHere(effect.window).then(() => finish(stay));
      return;
    case "minimize":
      void host?.minimize(effect.window);
      return backToSearch();
    case "close":
      void host?.close(effect.window);
      return backToSearch();
    case "quit":
      void host?.quit(effect.windows);
      // Quit is done once asked, like the other verbs: the launcher goes (⇧↩ stays and says so).
      if (!stay) return finish(false);
      sayDone(`Quitting ${effect.name}`);
      return backToSearch();
    case "show-in-files":
      host?.showInFiles(effect.file);
      return finish(stay);
    case "trash":
      void host?.trash(effect.file).then((ok) => sayDone(ok ? `Moved “${effect.file.name}” to the Trash` : "Couldn't move it to the Trash", ok));
      return backToSearch();
    case "pin":
      host?.pin(effect.entry, effect.pin);
      sayDone(effect.pin ? "Kept in Dock" : "Removed from Dock");
      return backToSearch();
  }
}

/** The person's own words for a row: an alias, a key, the ranking forgotten. */
function performEdit(effect: Of<"alias" | "unalias" | "shortcut" | "unshortcut" | "forget" | "forget-all">, d: PerformDeps): void {
  const { props, s, search, backToSearch } = d;
  const { sayDone } = search;
  switch (effect.kind) {
    case "alias":
      s.setMode({ kind: "alias", address: effect.address, title: effect.title } satisfies Mode);
      s.setFilter(s.prefs.aliasOf(effect.address) ?? "");
      return;
    case "unalias":
      props.prefs?.setAlias(effect.address, null);
      sayDone("Alias removed");
      return backToSearch();
    case "shortcut":
      s.setMode({ kind: "shortcut", address: effect.address, title: effect.title, when: null });
      s.setFilter("");
      props.keys?.record?.(true);
      return;
    case "unshortcut":
      props.prefs?.setKey(effect.address, null);
      sayDone("Shortcut removed");
      return backToSearch();
    case "forget":
      props.ranking?.forget(effect.id);
      sayDone("Ranking reset");
      return backToSearch();
    case "forget-all":
      props.ranking?.forgetAll();
      sayDone("All ranking reset");
      return backToSearch();
  }
}
