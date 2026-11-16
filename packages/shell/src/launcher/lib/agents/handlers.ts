/**
 * What the launcher's keys and rows do with agents, given what the launcher
 * holds (launcher.tsx passes its state and setters in): an agents' row's
 * act and ⇥. One path (decisions.md D261): the words go to Dashi's agent and
 * the launcher becomes the conversation; nothing plans, nothing is handed off.
 */

import type { Outcome } from "../../../actions/index.ts";
import type { Row } from "../../row-model.ts";
import type { LauncherAgents, LauncherAgentsSnapshot } from "../../types.ts";
import type { AgentAct } from "./acts.ts";

export interface AgentHandlerDeps {
  agents: LauncherAgents | undefined;
  snapshot: LauncherAgentsSnapshot | null;
  /** Where the launcher is: searching, in the conversation, or elsewhere. */
  mode: "search" | "talk" | "other";
  /** The search words, trimmed. */
  text: string;
  selectedRow: Row | undefined;
  /** The words to Dashi's agent, and the launcher becomes the conversation; with none, the conversation as it is. */
  talk(words?: string): void;
  back(): void;
  close(): void;
  say(outcome: Outcome): void;
  sayDone(text: string): void;
  /** ⇥ with no answerer picked: "Set up an agent…" for these words, selected. */
  offerSetUp(words: string): void;
}

export interface AgentHandlers {
  act(act: AgentAct): void;
  tab(): void;
}

export function agentHandlers(deps: AgentHandlerDeps): AgentHandlers {
  const remote = deps.agents;
  const act = (value: AgentAct): void => {
    if (value.kind === "ask") return deps.talk(value.query);
    if (!remote) return;
    switch (value.kind) {
      case "set-up":
      case "history":
        remote.setUp();
        return deps.close();
      case "now":
        if (value.item.kind === "turn") return void remote.goTo(value.item).then(deps.close);
        if (value.item.kind === "task") {
          remote.stop(value.item);
          return deps.back();
        }
        remote.setUp();
        return deps.close();
      case "stop":
        remote.stop(value.item);
        return deps.back();
      case "undo":
        void remote
          .undo(value.entry, value.index, value.undo)
          .then((outcome) => (outcome.ok ? deps.sayDone(`Undone: ${value.undo.title}`) : deps.say(outcome)));
        return deps.back();
    }
  };

  /** ⇥: the words to Dashi's agent; with none, the conversation (its empty view says what can be asked). */
  const tab = (): void => {
    if (deps.mode !== "search") return;
    if (!deps.text) {
      if (deps.snapshot?.answerer) deps.talk();
      return;
    }
    if (deps.snapshot?.answerer) return act({ kind: "ask", query: deps.text });
    if (deps.snapshot?.unset) deps.offerSetUp(deps.text);
  };

  return { act, tab };
}
