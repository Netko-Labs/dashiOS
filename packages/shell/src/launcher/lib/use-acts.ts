/**
 * What the launcher does (launcher.tsx): moving the selection, stepping between
 * its modes, the words to Dashi's agent (the conversation), and doing a row's
 * verb, asking first when the verb says to.
 */

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { LauncherProps } from "../props.ts";
import type { Row } from "../row-model.ts";
import type { LauncherScope, ScopeResult } from "../types.ts";
import { type Effect, historyId, type Verb } from "../verbs.ts";
import { SET_UP_ROW } from "./agents/agent-rows.ts";
import { type AgentHandlers, agentHandlers } from "./agents/handlers.ts";
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
  /** Words to Dashi's agent, and the launcher becomes the conversation; with none, the conversation as it is. */
  talk(words?: string): void;
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
    if (mode.kind === "search") s.setHeld((now) => moveSelection(latest.current, now, how));
    // The empty conversation's tries: ↑ and ↓ choose one.
    else if (mode.kind === "talk") s.setTryAt((now) => (how === "up" || how === "page-up" || how === "first" ? Math.max(0, now - 1) : now + 1));
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
  /** The conversation: `words` (if any) go to Dashi's agent as the next turn; the field starts empty. */
  const talk = (words?: string) => {
    if (words?.trim() && !props.dashi?.type(words.trim())) return;
    search.restart("");
    s.setMode({ kind: "talk" });
    s.setFilter("");
    s.setTryAt(0);
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
  return { backToSearch, openActions, talk, enterScope, scopeDone };
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
  // Agents' rows and ⇥ (launcher/lib/agents/handlers.ts).
  const agentKeys = agentHandlers({
    agents: props.agents,
    snapshot: s.agents,
    mode: s.mode.kind === "search" || s.mode.kind === "talk" ? s.mode.kind : "other",
    text: search.text,
    selectedRow: search.selectedRow,
    talk: steps.talk,
    back: steps.backToSearch,
    close: props.onClose,
    say: search.say,
    sayDone: search.sayDone,
    offerSetUp: (words) => {
      s.setTabbed(words);
      s.setHeld(SET_UP_ROW);
    },
  });
  const performing = (effect: Effect, row: Row | undefined, stay = false): void =>
    perform(effect, row, stay, { props, s, search, learn, ...steps, agentAct: agentKeys.act });
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
  return { move, fieldRevision, setFieldRevision, ...steps, agentKeys, perform: performing, doVerb };
}
