/**
 * The launcher's Ask tasks: one per request, each a conversation with the
 * chosen answerer (answerer.ts) and its plan (plan.ts).
 *
 * - Asking sends the typed words and the plan's tools; the reply's calls
 *   become steps, shown before anything runs.
 * - Running the plan is "Allow Once" for exactly those calls with exactly
 *   those arguments. It counts only if the person pressed Return themselves:
 *   the compositor's `input-origin` is asked, as a consent sheet's yes is
 *   (agents/person.ts). If it can't say so, the steps read "Not allowed"
 *   with "Allow once" right there, which asks again on the person's press.
 * - Steps run one after another through the action registry, logged as the
 *   answerer's with the task's id (actions/start.ts `runApproved`). A step
 *   whose action asks every time (force quit, the Trash) still asks on its
 *   own sheet; a no there is "Not allowed".
 * - A settings change remembers the value it had, for Undo (history.ts).
 * - A follow-up continues the conversation: the model hears how each call
 *   went, then the new words, and plans again.
 */

import type { ActionDef, ActionState, Args, Outcome } from "../../actions/types.ts";
import { AnswerError, type Answerer, type AnswererInfo, type AnswerFailure, type Turn } from "./answerer.ts";
import type { HistoryLog, HistoryStep, StepOutcome } from "./history.ts";
import { oneLine, planTools, resultFor, runnable, type Step, type StepState, settingWords, spokenWords, stepsFrom, type Undo } from "./plan.ts";

export type TaskPhase = "asking" | "planned" | "running" | "done" | "failed" | "stopped";

export interface TaskView {
  id: string;
  answerer: AnswererInfo;
  /** The words this plan answers (the latest follow-up's). */
  request: string;
  phase: TaskPhase;
  steps: readonly Step[];
  /** What the model said besides its calls, on one line. */
  said: string;
  failure: { kind: AnswerFailure; text: string } | null;
  /** A failed ask that has left "Now" (a while after, or once the launcher closed); still Retry-able from its plan, and in the history. */
  leftNow?: true;
}

export interface TaskDeps {
  /** The answerer Settings names now; null for none. */
  answerer(): Answerer | null;
  /** The registry's actions, for the plan's tools and its steps. */
  actions(): readonly ActionDef[];
  /** Run one approved step, logged as `by.agent`'s, in task `by.task`. */
  run(action: ActionDef, args: Args, by: { agent: string; task: string }): Promise<Outcome>;
  /** Whether the person's own hands pressed the launcher just now (`input-origin`). */
  personPressed(): Promise<boolean>;
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

interface Task {
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

const REAL_TIMERS: Required<TaskDeps>["timers"] = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Tasks kept in memory (the history keeps the rest). */
const KEEP = 20;

const outcomeOf = (state: StepState): StepOutcome =>
  state.kind === "done"
    ? "done"
    : state.kind === "not-allowed"
      ? "not-allowed"
      : state.kind === "invalid"
        ? "invalid"
        : state.kind === "failed"
          ? "failed"
          : "skipped";

export class AskTasks {
  private tasks: Task[] = [];
  private snapshot: readonly TaskView[] = [];
  private readonly listeners = new Set<() => void>();
  private next = 0;

  constructor(private readonly deps: TaskDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly TaskView[] => this.snapshot;

  get(id: string): TaskView | undefined {
    return this.snapshot.find((task) => task.id === id);
  }

  private publish(): void {
    this.snapshot = this.tasks.map((task) => ({
      id: task.id,
      answerer: task.answerer.info,
      request: task.request,
      phase: task.phase,
      steps: task.steps.map((step) => ({ ...step })),
      said: task.said,
      failure: task.failure,
      ...(task.leftNow ? { leftNow: true as const } : {}),
    }));
    for (const listener of this.listeners) listener();
  }

  private find(id: string): Task | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  /** Ask the answerer about `request`: a new task, or null when no answerer is chosen. */
  ask(request: string): string | null {
    const answerer = this.deps.answerer();
    const text = request.trim();
    if (!answerer || !text) return null;
    const task: Task = {
      id: `ask-${(this.deps.now?.() ?? Date.now()).toString(36)}-${++this.next}`,
      answerer,
      request: text,
      phase: "asking",
      steps: [],
      said: "",
      failure: null,
      history: [],
      turn: { text, results: [] },
      serial: 0,
      controller: new AbortController(),
      leftNow: false,
      leaving: null,
    };
    this.tasks = [task, ...this.tasks].slice(0, KEEP);
    void this.plan(task);
    return task.id;
  }

  /** Words for a task that has answered: the model hears how its calls went, then plans again. */
  followUp(id: string, words: string): boolean {
    const task = this.find(id);
    const text = words.trim();
    if (!task || !text || task.phase === "asking" || task.phase === "running") return false;
    task.turn = { text, results: task.steps.map(resultFor) };
    task.request = text;
    task.controller = new AbortController();
    void this.plan(task);
    return true;
  }

  /** Ask again after it didn't answer. */
  retry(id: string): void {
    const task = this.find(id);
    if (!task || task.phase !== "failed") return;
    task.controller = new AbortController();
    void this.plan(task);
  }

  private async plan(task: Task): Promise<void> {
    this.stayInNow(task);
    task.phase = "asking";
    task.steps = [];
    task.said = "";
    task.failure = null;
    this.publish();
    const { signal } = task.controller;
    const actions = this.deps.actions();
    try {
      const { reply, history } = await task.answerer.turn(task.history, task.turn, planTools(actions), signal);
      if (signal.aborted) return;
      task.history = history;
      task.serial++;
      task.steps = stepsFrom(reply.calls, actions);
      // What it says to the person, never its tools' chatter (plan.ts `spokenWords`).
      task.said = spokenWords(reply.text);
      // Nothing to run (it said it can't): the plan view shows its words, and Now lets it go.
      task.phase = task.steps.length > 0 ? "planned" : "done";
    } catch (error) {
      if (signal.aborted) return;
      task.phase = "failed";
      task.failure =
        error instanceof AnswerError ? { kind: error.failure, text: error.message } : { kind: "failed", text: `${task.answerer.info.name} didn't answer.` };
      // In the history as the plan it would have been (a Retry that answers replaces the line), and out of Now in a while.
      this.keep(task, task.serial + 1, task.failure.text);
      task.leaving = (this.deps.timers ?? REAL_TIMERS).set(() => this.leaveNow(task), FAILED_STAYS_MS);
    }
    this.publish();
  }

  /** A failed ask goes from "Now": its plan (with Retry) and its history line stay. */
  private leaveNow(task: Task): void {
    task.leaving = null;
    if (task.phase !== "failed" || task.leftNow) return;
    task.leftNow = true;
    this.publish();
  }

  /** Asked again: back in "Now" while it is. */
  private stayInNow(task: Task): void {
    if (task.leaving !== null) (this.deps.timers ?? REAL_TIMERS).clear(task.leaving);
    task.leaving = null;
    task.leftNow = false;
  }

  /** The launcher closed: every failed ask leaves "Now" at once. */
  letFailedGo(): void {
    const failed = this.tasks.filter((task) => task.phase === "failed" && !task.leftNow);
    for (const task of failed) {
      this.stayInNow(task);
      task.leftNow = true;
    }
    if (failed.length > 0) this.publish();
  }

  /**
   * Return on the plan: run exactly its steps, if the person pressed it. A
   * press that can't be confirmed as theirs runs nothing.
   */
  async run(id: string): Promise<void> {
    const task = this.find(id);
    if (!task || task.phase !== "planned") return;
    const steps = runnable(task.steps);
    if (steps.length === 0) return;
    if (!(await this.deps.personPressed())) {
      for (const step of steps) step.state = { kind: "not-allowed" };
      this.publish();
      return;
    }
    task.phase = "running";
    this.publish();
    for (const step of steps) {
      if (task.phase !== "running") break;
      await this.runStep(task, step);
    }
    if (task.phase === "running") task.phase = "done";
    this.keep(task);
    this.publish();
  }

  /** "Allow once" on a step that wasn't allowed: run it alone, if the person pressed it. */
  async allowOnce(id: string, index: number): Promise<void> {
    const task = this.find(id);
    const step = task?.steps[index];
    if (!task || !step || step.state.kind !== "not-allowed" || task.phase === "running" || task.phase === "asking") return;
    if (!(await this.deps.personPressed())) return;
    const before = task.phase;
    task.phase = "running";
    await this.runStep(task, step);
    task.phase = before === "planned" && runnable(task.steps).length > 0 ? "planned" : "done";
    this.keep(task);
    this.publish();
  }

  private async runStep(task: Task, step: Step): Promise<void> {
    const action = step.action;
    if (!action) return;
    step.state = { kind: "running" };
    this.publish();
    // A settings change remembers what it was, so it can be put back.
    let undo: Undo | undefined;
    if (action.tool === "set_setting" && typeof step.args.name === "string") {
      const was = this.deps.settingNow(step.args.name);
      if (was !== null && was !== step.args.value) {
        undo = { address: action.address, args: { name: step.args.name, value: was }, title: settingWords(step.args.name, was) };
      }
    }
    let outcome: Outcome;
    try {
      outcome = await this.deps.run(action, step.args, { agent: task.answerer.info.name, task: task.id });
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (outcome.ok) {
      step.state = { kind: "done", text: oneLine(outcome.text, 120) };
      if (undo) step.undo = undo;
    } else {
      step.state = outcome.error === "Cancelled." ? { kind: "not-allowed" } : { kind: "failed", error: oneLine(outcome.error, 100) };
    }
    this.publish();
  }

  /** Write this plan's steps to the history (a later line for the same plan replaces the earlier). */
  private keep(task: Task, serial = task.serial, failure?: string): void {
    const steps: HistoryStep[] = task.steps.map((step) => ({ title: step.title, outcome: outcomeOf(step.state), ...(step.undo ? { undo: step.undo } : {}) }));
    this.deps.history.add({
      task: `${task.id}.${serial}`,
      time: Math.floor((this.deps.now?.() ?? Date.now()) / 1000),
      agent: task.answerer.info.name,
      request: task.request,
      steps,
      ...(failure === undefined ? {} : { failure }),
    });
  }

  /** Put a settings change back: from a task here, or from the history (`entry` is its id). */
  async undo(entry: string, index: number, undo: Undo): Promise<Outcome> {
    const outcome = await this.deps.undo(undo);
    if (!outcome.ok) return outcome;
    this.deps.history.undone(entry, index);
    const task = this.tasks.find((each) => `${each.id}.${each.serial}` === entry);
    const step = task?.steps[index];
    if (step) {
      step.undone = true;
      this.publish();
    }
    return outcome;
  }

  /** Stop: no answer is waited for, and no step not yet started runs. */
  stop(id: string): void {
    const task = this.find(id);
    if (!task) return;
    task.controller.abort();
    if (task.phase === "running") {
      for (const step of task.steps) if (step.state.kind === "ready") step.state = { kind: "skipped" };
      this.keep(task);
    }
    task.phase = "stopped";
    this.publish();
  }

  /** The history id of a task's current plan (Undo from the launcher). */
  entryOf(id: string): string | null {
    const task = this.find(id);
    return task ? `${task.id}.${task.serial}` : null;
  }
}

/** Tasks still in "Now": asking, waiting for Return, running, or failed just now (FAILED_STAYS_MS, or until the launcher closes). */
export const isActive = (task: TaskView): boolean =>
  task.phase === "asking" || task.phase === "planned" || task.phase === "running" || (task.phase === "failed" && task.leftNow !== true);
