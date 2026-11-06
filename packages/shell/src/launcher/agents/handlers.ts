/**
 * What the launcher's keys and rows do with agents, given what the launcher
 * holds (launcher.tsx passes its state and setters in): an agents' row's act,
 * ⇥, and Return on a plan. Kept here so the launcher's own code only wires it.
 */

import type { Outcome } from "../../actions/types.ts";
import type { TaskView } from "../../agents/ask/tasks.ts";
import type { Row } from "../row-model.ts";
import type { AgentAct } from "./acts.ts";
import type { LauncherAgents, LauncherAgentsSnapshot } from "./rows.ts";
import { taskSubmit } from "./task-mode.tsx";

export interface AgentHandlerDeps {
  agents: LauncherAgents | undefined;
  snapshot: LauncherAgentsSnapshot | null;
  /** Where the launcher is: searching, or on a plan (`task`, maybe gone from the store). */
  mode: "search" | "task" | "other";
  task: TaskView | undefined;
  /** The search words, trimmed. */
  text: string;
  /** What the field holds on a plan: a follow-up. */
  draft: string;
  selectedRow: Row | undefined;
  openTask(id: string): void;
  clearDraft(): void;
  /** Back to searching, with these words in the field. */
  editWords(words: string): void;
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
  /** Return on a plan, with step `step` selected (or none). */
  submit(step: number | null): void;
}

export function agentHandlers(deps: AgentHandlerDeps): AgentHandlers {
  const remote = deps.agents;
  const act = (value: AgentAct): void => {
    if (!remote) return;
    switch (value.kind) {
      case "ask": {
        const id = remote.ask(value.query);
        if (id) deps.openTask(id);
        return;
      }
      case "set-up":
      case "history":
        remote.setUp();
        return deps.close();
      case "now":
        if (value.item.kind === "task") return deps.openTask(value.item.id);
        if (value.item.kind === "turn") return void remote.goTo(value.item).then(deps.close);
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

  const tab = (): void => {
    if (deps.mode === "task") return deps.editWords(deps.task?.request ?? "");
    if (deps.mode !== "search") return;
    const row = deps.selectedRow;
    if (!deps.text) {
      // On a Now task, ⇥ opens its plan, ready for a follow-up.
      if (row?.action.kind === "agent" && row.action.act.kind === "now") act(row.action.act);
      return;
    }
    if (deps.snapshot?.answerer) return act({ kind: "ask", query: deps.text });
    if (deps.snapshot?.unset) deps.offerSetUp(deps.text);
  };

  const submit = (step: number | null): void => {
    const task = deps.task;
    if (!remote || !task) return;
    const choice = taskSubmit(task, deps.draft, step);
    switch (choice.kind) {
      case "follow-up":
        if (remote.followUp(task.id, choice.text)) deps.clearDraft();
        return;
      case "run":
        return remote.run(task.id);
      case "allow-once":
        return remote.allowOnce(task.id, choice.step);
      case "undo": {
        const entry = remote.entryOf(task.id);
        const undo = task.steps[choice.step]?.undo;
        if (entry && undo) void remote.undo(entry, choice.step, undo).then((outcome) => !outcome.ok && deps.say(outcome));
        return;
      }
      case "retry":
        return remote.retry(task.id);
      case "settings":
        remote.setUp();
        return deps.close();
      case "none":
        return;
    }
  };

  return { act, tab, submit };
}
