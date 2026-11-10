/**
 * "Now" (docs/betterments.html, "What is acting now"): what agents are
 * doing for the person this moment, for the top of an empty launcher. A
 * pending "Your turn" comes first, then the launcher's own Ask tasks, then
 * the agents connected over MCP with what each is doing. Pure, from the
 * stores: the turns (TurnWatch), the tasks (tasks.ts), and the menu bar's
 * AgentStore.
 */

import type { AgentInfo, Turn } from "../presence.ts";
import { isActive } from "./lib/task-types.ts";
import type { TaskView } from "./types.ts";

export type NowItem =
  /** An agent handed a window to the person (hand_over): Return brings it forward. */
  | { kind: "turn"; agent: number; name: string; reason: string; window: number | null }
  /** A launcher Ask. */
  | { kind: "task"; id: string; name: string; status: string; phase: TaskView["phase"] }
  /** An agent connected over MCP. */
  | { kind: "agent"; id: number; name: string; status: string };

/** The words after a task's request in its Now row. */
export function taskStatus(task: TaskView): string {
  switch (task.phase) {
    case "asking":
      return "planning";
    case "planned":
      return task.steps.length === 1 ? "1 step ready" : `${task.steps.length} steps ready`;
    case "running": {
      const done = task.steps.filter((step) => step.state.kind !== "ready" && step.state.kind !== "running").length;
      return `${done} of ${task.steps.length}`;
    }
    case "failed":
      return "didn't answer";
    default:
      return "";
  }
}

/** Everything in Now, in order. */
export function nowItems(input: { turns: readonly Turn[]; tasks: readonly TaskView[]; agents: readonly AgentInfo[] }): NowItem[] {
  const turns: NowItem[] = input.turns.map((turn) => ({
    kind: "turn",
    agent: turn.agent,
    name: turn.who.remote ? "Agent" : turn.who.name,
    reason: turn.reason,
    window: turn.window ?? null,
  }));
  const tasks: NowItem[] = input.tasks.filter(isActive).map((task) => ({
    kind: "task",
    id: task.id,
    name: task.answerer.name,
    status: `${task.request} · ${taskStatus(task)}`,
    phase: task.phase,
  }));
  const handing = new Set(input.turns.map((turn) => turn.agent));
  // A run started from the launcher is listed as itself ("Agents"), not as its connection.
  const agents: NowItem[] = input.agents
    .filter((agent) => !handing.has(agent.id) && agent.task === undefined)
    .map((agent) => ({ kind: "agent", id: agent.id, name: agent.name, status: agent.status }));
  return [...turns, ...tasks, ...agents];
}

/** The "Your turn" banners up now, as a store: the shell's AgentUi tells it as each goes up and down. */
export class TurnWatch {
  private turns: readonly Turn[] = [];
  private readonly listeners = new Set<() => void>();

  /** `turn` is up until `done` settles. */
  track<T>(turn: Turn, done: Promise<T>): Promise<T> {
    this.turns = [...this.turns.filter((each) => each.agent !== turn.agent), turn];
    this.notify();
    const gone = () => {
      this.turns = this.turns.filter((each) => each !== turn);
      this.notify();
    };
    done.then(gone, gone);
    return done;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Turn[] => this.turns;

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
