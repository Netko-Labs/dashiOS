/** What a launcher Ask task needs (`TaskDeps`), and when it still counts as "Now" (`TaskView` is in types.ts). */

import type { ActionDef, ActionState, Args, Outcome } from "../../../actions/types.ts";
import type { Answerer, Turn } from "../answerer.ts";
import type { HistoryLog, StepOutcome } from "../history.ts";
import type { Step, StepState, Undo } from "../plan.ts";
import type { TaskPhase, TaskView } from "../types.ts";

export interface TaskDeps {
  /** The answerer Settings names now; null for none. */
  answerer(): Answerer | null;
  /** The registry's actions, for the plan's tools and its steps. */
  actions(): readonly ActionDef[];
  /** Run one approved step, logged as `by.agent`'s, in task `by.task`. */
  run(action: ActionDef, args: Args, by: { agent: string; task: string }): Promise<Outcome>;
  /** Whether the person's own hands pressed the launcher just now (`input-origin`), or said yes to `task`'s card. */
  personPressed(task: string): Promise<boolean>;
  /** A setting's value now, for Undo; null where it has none. */
  settingNow(name: string): ActionState;
  /** Put a setting back, as the person. */
  undo(undo: Undo): Promise<Outcome>;
  history: Pick<HistoryLog, "add" | "undone">;
  now?(): number;
  /** For a failed ask's stay in Now; real timers when left out. */
  timers?: { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };
}

/** How long a failed ask stays in "Now" (unless the launcher closes first). */
export const FAILED_STAYS_MS = 10_000;

/** A task as the store keeps it (`TaskView` is what is shown of it). */
export interface Task {
  id: string;
  answerer: Answerer;
  request: string;
  phase: TaskPhase;
  steps: Step[];
  said: string;
  failure: TaskView["failure"];
  /** What the answerer returned last time: sent with the next turn. */
  history: unknown[];
  /** The turn being asked (Retry sends it again). */
  turn: Turn;
  /** How many plans this task has had; each is its own entry in the history. */
  serial: number;
  controller: AbortController;
  /** Failed and out of "Now"; and the timer that takes it out. */
  leftNow: boolean;
  leaving: unknown;
}

/** How a step ended, for the history. */
export const outcomeOf = (state: StepState): StepOutcome =>
  state.kind === "done"
    ? "done"
    : state.kind === "not-allowed"
      ? "not-allowed"
      : state.kind === "invalid"
        ? "invalid"
        : state.kind === "failed"
          ? "failed"
          : "skipped";

/** Tasks still in "Now": asking, waiting for Return, running, or failed just now (FAILED_STAYS_MS, or until the launcher closes). */
export const isActive = (task: TaskView): boolean =>
  task.phase === "asking" || task.phase === "planned" || task.phase === "running" || (task.phase === "failed" && task.leftNow !== true);
