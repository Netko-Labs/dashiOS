/**
 * What the launcher does (launcher.tsx): moving the selection, stepping between
 * its modes, handing a request to an agent, and doing a row's verb, asking
 * first when the verb says to.
 */

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { HarnessId } from "../../agents/ask/answerer.ts";
import { contextPrompt } from "../../agents/handoff/grants.ts";
import { SET_UP_ROW } from "../agent-rows.ts";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import type { LauncherScope, ScopeResult } from "../types.ts";
import { type Effect, historyId, type Verb } from "../verbs.ts";
import type { AgentAct } from "./agents/acts.ts";
import { type AgentHandlers, agentHandlers } from "./agents/handlers.ts";
import { chosenContext } from "./agents/handoff-views.tsx";
import type { ModeLists } from "./mode.ts";
import { perform } from "./perform.ts";
import { type Move, moveSelection } from "./selection.ts";
import type { LauncherState, Search } from "./state.ts";

export interface Acts {
  /** Moves the selection as ↑ and ↓ do (and ⌃N, Page Down, Home… from the compositor). */
  move: { current: (how: Move) => void };
  /** Bumped to give the field its text back after a key the launcher took (launcher/lib/field.tsx). */
  fieldRevision: number;
  setFieldRevision: Dispatch<SetStateAction<number>>;
  backToSearch(): void;
  openActions(row: Row | undefined): void;
  /** Into a scope, in place (its row chosen), or out of it (Esc): the field starts empty. */
  enterScope(next: LauncherScope | null): void;
  /** The words and the chips left on: what a hand-off starts with. */
  handOff(harness: HarnessId, request: string, watch: boolean): void;
  talkTo(run: string): void;
  handoffAct(act: AgentAct): boolean;
  agentKeys: AgentHandlers;
  perform(effect: Effect, row: Row | undefined, stay?: boolean): void;
  /** Do `verb`, asking first in place when it says to. */
  doVerb(verb: Verb | undefined, row: Row | undefined, stay?: boolean): void;
}

/** The selection moves through what the list holds now; `latest` is read when the compositor's keys come. */
function useMove(props: LauncherProps, s: LauncherState, search: Search, lists: ModeLists): { current: (how: Move) => void } {
  const { keys } = props;
  const { mode } = s;
  const latest = useRef(lists.listIds);
  latest.current = lists.listIds;
  const mover = (how: Move) => {
    search.pictures.fold();
    if (mode.kind === "grants") {
      s.setGrantsRow((now) => (how === "up" || how === "first" || how === "page-up" ? 0 : how === "down" || how === "last" || how === "page-down" ? 1 : now));
      return;
    }
    if (mode.kind === "search") s.setHeld((now) => moveSelection(latest.current, now, how));
    else if (mode.kind === "task")
      s.setHeldVerb((now) =>
        now === null ? (latest.current[how === "up" || how === "last" ? latest.current.length - 1 : 0] ?? null) : moveSelection(latest.current, now, how),
      );
    else s.setHeldVerb((now) => moveSelection(latest.current, now, how));
    s.setAsking(null);
  };
  const move = useRef(mover);
  move.current = mover;
  // The compositor's keys (⌃N, Page Down, Home…) move it as ↑ and ↓ do; `latest` is read when they come.
  useEffect(() => keys?.subscribe((how) => move.current(how)), [keys]);
  return move;
}

/** Stepping between modes: back to the search, a row's action list, a plan, a scope, words to a run. */
function modeSteps(props: LauncherProps, s: LauncherState, search: Search) {
  const backToSearch = () => {
    if (s.mode.kind === "shortcut") props.keys?.record?.(false);
    s.setMode({ kind: "search" });
    s.setFilter("");
    s.setHeldVerb(null);
    s.setAsking(null);
  };
  const openActions = (row: Row | undefined) => {
    if (!row || search.verbsOf(row).length < 2) return;
    s.setMode({ kind: "actions", row });
    s.setFilter("");
    s.setHeldVerb(null);
    s.setAsking(null);
  };
  /**
   * Show a task's plan; the field takes a follow-up. The words asked are the plan's now (its chip; ⇥ edits
   * them): the search is left empty, so going back to it never puts them in the field again, where they
   * took the place of what was typed next ("history" right after a plan ran).
   */
  const openTask = (id: string) => {
    search.restart("");
    s.setMode({ kind: "task", id });
    s.setFilter("");
    s.setHeldVerb(null);
    s.setAsking(null);
  };
  const enterScope = (next: LauncherScope | null) => {
    s.setScoped(next ? { scope: next, alone: false } : null);
    backToSearch();
    search.restart("");
  };
  /** What a scope's verb asked for once it ran. */
  const scopeDone = (result: ScopeResult, stay: boolean) => {
    if (result.close && !stay) return props.onClose();
    if (s.mode.kind !== "search") backToSearch();
    if (result.query !== undefined) search.restart(result.query);
    if (result.notice) s.setNotice(result.notice);
  };
  const talkTo = (run: string) => {
    s.setMode({ kind: "message", run });
    s.setFilter("");
    s.setHeldVerb(null);
  };
  return { backToSearch, openActions, openTask, enterScope, scopeDone, talkTo };
}

/** Agents from the launcher: a hand-off (through the grants card when it needs one), and the runs' own acts. */
function handoffSteps(props: LauncherProps, s: LauncherState, search: Search, talkTo: (run: string) => void) {
  const { onClose } = props;
  const handOff = (harness: HarnessId, request: string, watch: boolean) => {
    const remote = props.handoff;
    if (!remote || !request.trim()) return;
    const chosen = chosenContext(s.context, s.chipsOn);
    if (remote.needsCard(chosen)) {
      s.setMode({ kind: "grants", harness, watch });
      s.setFilter(request.trim());
      s.setGrantsRow(0);
      return;
    }
    remote.start({ harness, request: request.trim(), context: chosen }, watch);
    onClose();
  };
  /** Agents from the launcher's own acts; false for the rest (launcher/lib/agents/handlers.ts has them). */
  const handoffAct = (act: AgentAct): boolean => {
    const remote = props.handoff;
    if (!remote) return false;
    switch (act.kind) {
      case "hand-off":
        handOff(act.harness, act.query, act.watch === true);
        return true;
      case "sign-in-harness":
        remote.signIn(act.harness);
        onClose();
        return true;
      case "run":
        remote.open(act.run);
        onClose();
        return true;
      case "stop-run":
        remote.stop(act.run);
        search.sayDone("Stopped");
        return true;
      case "tell":
        talkTo(act.run);
        return true;
      default:
        return false;
    }
  };
  return { handOff, handoffAct };
}

/** The launcher's acts, for its keys, its field and its rows. */
export function useActs(props: LauncherProps, s: LauncherState, search: Search, lists: ModeLists): Acts {
  const move = useMove(props, s, search, lists);
  const steps = modeSteps(props, s, search);
  const [fieldRevision, setFieldRevision] = useState(0);
  const { ranking } = props;
  /** What the ranking learns: this row was chosen for what was typed (or opened, with nothing typed). */
  const learn = (row: Row | undefined) => {
    const id = row ? historyId(row) : null;
    if (!ranking || !id || row?.id.startsWith("try:")) return;
    if (row?.action.kind === "open-file") ranking.opened(id);
    else if (search.text) ranking.picked(search.text, id);
    else ranking.opened(id);
  };
  // Agents' rows, ⇥, and Return on a plan (launcher/lib/agents/handlers.ts).
  const agentKeys = agentHandlers({
    agents: props.agents,
    snapshot: s.agents,
    mode: s.mode.kind === "search" || s.mode.kind === "task" ? s.mode.kind : "other",
    task: search.task,
    text: search.text,
    draft: s.filter,
    selectedRow: search.selectedRow,
    openTask: steps.openTask,
    clearDraft: () => s.setFilter(""),
    editWords: (words) => {
      steps.backToSearch();
      search.restart(words);
    },
    back: steps.backToSearch,
    close: props.onClose,
    say: search.say,
    sayDone: search.sayDone,
    offerSetUp: (words) => {
      s.setTabbed(words);
      s.setHeld(SET_UP_ROW);
    },
    // Ask gets the context chips too: the ones left on, in words, after the request.
    context: () => (search.contextShown ? contextPrompt(chosenContext(s.context, s.chipsOn), false) : ""),
  });
  const { handOff, handoffAct } = handoffSteps(props, s, search, steps.talkTo);
  const performing = (effect: Effect, row: Row | undefined, stay = false): void =>
    perform(effect, row, stay, { props, s, search, learn, ...steps, handoffAct, agentAct: agentKeys.act });
  const doVerb = (verb: Verb | undefined, row: Row | undefined, stay = false) => {
    if (!verb) return;
    if (verb.confirm && s.asking !== verb.id) {
      s.setAsking(verb.id);
      s.setHeldVerb(`verb:${verb.id}`);
      if (s.mode.kind === "search" && row) s.setMode({ kind: "actions", row });
      return;
    }
    s.setAsking(null);
    performing(verb.effect, row, stay);
  };
  return { move, fieldRevision, setFieldRevision, ...steps, handOff, handoffAct, agentKeys, perform: performing, doVerb };
}
