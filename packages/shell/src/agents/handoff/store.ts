/**
 * The agents started from the launcher, as one store (docs/actions.md,
 * "Agents from the launcher"): each run's request, harness, steps (from its
 * stream, stream.ts), the question it waits on, and how it ended. The menu
 * bar's chip and panel, the launcher's Agents rows and the done
 * notification all read it. Pure: the clock comes in, and nothing here
 * starts or stops a process (service.ts does, and tells it).
 *
 * A finished run stays an hour (`RETAIN_MS`), with Undo for what it changed
 * that can be put back.
 */

import type { HarnessId } from "../ask/answerer.ts";
import type { Undo } from "../ask/plan.ts";
import { type RunEvent, stepsPlanned } from "./stream.ts";
import { cut, stepWords } from "./words.ts";

/** How long a finished run stays in the panel and the launcher. */
export const RETAIN_MS = 60 * 60 * 1000;
/** Steps a card shows (the panel never shows a transcript). */
export const CARD_STEPS = 3;

export interface RunStep {
  id: string;
  /** Its words now: "Opening x" while it runs, "Opened x" once it has. */
  words: string;
  state: "running" | "done" | "failed";
}

export type RunPhase = "starting" | "working" | "done" | "failed" | "stopped";

/** A choice on a question in the panel. */
export interface QuestionChoice {
  id: string;
  label: string;
  primary?: true;
  danger?: true;
}

/** What a run waits on the person for: one at a time, in the panel and (closed) a sheet. */
export interface RunQuestion {
  id: string;
  kind: "sign-in" | "site" | "turn" | "scopes" | "confirm";
  /** "Use your bodytech.com.co login?" */
  title: string;
  /** "1Password · alexk@example.com" */
  detail: string;
  choices: readonly QuestionChoice[];
  /** Short, after the run's title in the launcher and the chip: "needs your OK to sign in". */
  needs: string;
}

/** What the person sent it after it started (⇥ on its row, Follow up). */
export interface RunMessage {
  text: string;
  at: number;
}

export interface RunView {
  id: string;
  request: string;
  harness: HarnessId;
  harnessName: string;
  /** When it started (ms). */
  started: number;
  phase: RunPhase;
  steps: readonly RunStep[];
  /** About how many steps it expects ("Steps: 6"), never fewer than it took. */
  about: number | null;
  /** The last thing it said. */
  said: string;
  /** Its last words when it ended well: the notification's. */
  summary: string;
  error: string | null;
  question: RunQuestion | null;
  /** The harness's session, for a follow-up. */
  session: string | null;
  /** When it ended (ms); null while it works. */
  ended: number | null;
  /** Its settings changes, with what puts each back. */
  undos: ReadonlyArray<{ undo: Undo; undone: boolean }>;
  messages: readonly RunMessage[];
  /** The turn it is on: each follow-up starts another. */
  turn: number;
}

export interface StartRun {
  id: string;
  request: string;
  harness: HarnessId;
  harnessName: string;
}

export const isWorking = (run: Pick<RunView, "phase">): boolean => run.phase === "starting" || run.phase === "working";

/** The step going on now, or the last one. */
export const currentStep = (run: RunView): RunStep | undefined => run.steps.at(-1);

/** "step 3 of about 6", "step 3", "starting". */
export function progressWords(run: RunView): string {
  const count = run.steps.length;
  if (count === 0) return run.phase === "starting" ? "starting" : "thinking";
  return run.about && run.about >= count ? `step ${count} of about ${run.about}` : `step ${count}`;
}

/** What a run is doing, in a few words, for the launcher's row and a card's line. */
export function statusWords(run: RunView): string {
  if (run.question) return run.question.needs;
  switch (run.phase) {
    case "starting":
      return "starting";
    case "working":
      return currentStep(run)?.words.toLowerCase() ?? "thinking";
    case "done":
      return run.summary ? `done · ${cut(run.summary, 60)}` : "done";
    case "failed":
      return run.error ? `stopped · ${cut(run.error, 60)}` : "stopped";
    case "stopped":
      return "stopped";
  }
}

/** The first line of its last words, for a notification's title, and the rest for its body. */
export function summaryLines(summary: string): { title: string; body: string } {
  const lines = summary
    .split("\n")
    .map((line) => line.replace(/[*_`#]/g, "").trim())
    .filter(Boolean);
  return { title: cut(lines[0] ?? "", 80), body: cut(lines.slice(1).join(" · "), 160) };
}

interface Run extends Omit<RunView, "steps" | "undos" | "messages"> {
  steps: RunStep[];
  undos: Array<{ undo: Undo; undone: boolean }>;
  messages: RunMessage[];
  /** Questions waiting, the first one shown. */
  waiting: Array<{ question: RunQuestion; resolve: (choice: string | null) => void }>;
  /** Calls in this turn by id: their tool and input, for their words when they end. */
  calls: Map<string, { tool: string; input: Record<string, unknown> }>;
  /** It was stopped by the person: an exit after that is "stopped", not a failure. */
  stopping: boolean;
}

export interface RunsOptions {
  now?: () => number;
  /** A tool's title from Dashi's catalog, for steps without words of their own. */
  titleOf?: (tool: string) => string | undefined;
}

export class AgentRuns {
  private runs: Run[] = [];
  private snapshot: readonly RunView[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly titleOf: (tool: string) => string | undefined;
  private nextQuestion = 0;

  constructor(options: RunsOptions = {}) {
    this.now = options.now ?? Date.now;
    this.titleOf = options.titleOf ?? (() => undefined);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Every run, newest first. */
  getSnapshot = (): readonly RunView[] => this.snapshot;

  get(id: string): RunView | undefined {
    return this.snapshot.find((run) => run.id === id);
  }

  start(input: StartRun): RunView {
    const run: Run = {
      ...input,
      started: this.now(),
      phase: "starting",
      steps: [],
      about: null,
      said: "",
      summary: "",
      error: null,
      question: null,
      session: null,
      ended: null,
      undos: [],
      messages: [],
      turn: 1,
      waiting: [],
      calls: new Map(),
      stopping: false,
    };
    this.runs = [run, ...this.runs.filter((each) => each.id !== input.id)];
    this.publish();
    return this.get(run.id) as RunView;
  }

  /** What the harness printed, read (stream.ts). */
  event(id: string, event: RunEvent): void {
    const run = this.find(id);
    if (!run || run.ended !== null) return;
    switch (event.kind) {
      case "session":
        if (run.session === event.id) return;
        run.session = event.id;
        break;
      case "call": {
        run.calls.set(event.id, { tool: event.tool, input: event.input });
        run.steps.push({ id: `${run.turn}:${event.id}`, words: stepWords(event.tool, event.input, false, this.titleOf(event.tool)), state: "running" });
        run.phase = "working";
        if (run.about !== null && run.about < run.steps.length) run.about = run.steps.length;
        break;
      }
      case "result": {
        const call = run.calls.get(event.id);
        const step = run.steps.find((each) => each.id === `${run.turn}:${event.id}`);
        if (!call || !step) return;
        step.state = event.ok ? "done" : "failed";
        step.words = stepWords(call.tool, call.input, event.ok, this.titleOf(call.tool));
        if (!event.ok) step.words = `Couldn't: ${step.words.charAt(0).toLowerCase()}${step.words.slice(1)}`;
        break;
      }
      case "said": {
        run.said = event.text;
        run.phase = "working";
        const planned = run.about === null ? stepsPlanned(event.text) : null;
        if (planned !== null) run.about = Math.max(planned, run.steps.length);
        break;
      }
      case "done":
        this.end(run, "done", event.text || run.said);
        break;
      case "failed":
        run.error = event.error;
        this.end(run, run.stopping ? "stopped" : "failed", "");
        break;
    }
    this.publish();
  }

  /** Its process ended (the runner's exit line): what the stream didn't say already. */
  exited(id: string, code: number | null): void {
    const run = this.find(id);
    if (!run || run.ended !== null) return;
    if (run.stopping) this.end(run, "stopped", "");
    else if (code === 0) this.end(run, "done", run.said);
    else {
      run.error ??= code === null ? "It was stopped." : `It ended with code ${code}.`;
      this.end(run, "failed", "");
    }
    this.publish();
  }

  /** The person stopped it: whatever ends it now is "stopped". */
  stopping(id: string): void {
    const run = this.find(id);
    if (!run) return;
    run.stopping = true;
    if (run.ended === null && run.phase === "starting") this.end(run, "stopped", "");
    this.publish();
  }

  /** A follow-up starts its next turn: it works again, with the words the person sent. */
  followUp(id: string, text: string): RunView | undefined {
    const run = this.find(id);
    if (!run) return undefined;
    run.messages.push({ text, at: this.now() });
    run.turn += 1;
    run.calls.clear();
    run.phase = "starting";
    run.ended = null;
    run.error = null;
    run.summary = "";
    run.stopping = false;
    this.publish();
    return this.get(id);
  }

  /** A question for the person; resolves with the choice's id, or null when it was taken back (or the run ended). */
  ask(id: string, question: Omit<RunQuestion, "id">): { question: RunQuestion; answer: Promise<string | null> } {
    const run = this.find(id);
    const asked: RunQuestion = { ...question, id: `q${++this.nextQuestion}` };
    if (!run || run.ended !== null) return { question: asked, answer: Promise.resolve(null) };
    const answer = new Promise<string | null>((resolve) => run.waiting.push({ question: asked, resolve }));
    this.showQuestion(run);
    this.publish();
    return { question: asked, answer };
  }

  /** The person's answer to `question` (or null to take it back): true if it was still waiting. */
  answer(id: string, question: string, choice: string | null): boolean {
    const run = this.find(id);
    const at = run?.waiting.findIndex((each) => each.question.id === question) ?? -1;
    if (!run || at < 0) return false;
    const [entry] = run.waiting.splice(at, 1);
    entry?.resolve(choice);
    this.showQuestion(run);
    this.publish();
    return true;
  }

  /** A settings change it made, with how to put it back. */
  changed(id: string, undo: Undo): void {
    const run = this.find(id);
    if (!run) return;
    run.undos.push({ undo, undone: false });
    this.publish();
  }

  undone(id: string, index: number): void {
    const entry = this.find(id)?.undos[index];
    if (!entry) return;
    entry.undone = true;
    this.publish();
  }

  /** Runs ended over an hour ago go; returns their ids (their files go too). */
  prune(): string[] {
    const cutoff = this.now() - RETAIN_MS;
    const gone = this.runs.filter((run) => run.ended !== null && run.ended < cutoff).map((run) => run.id);
    if (gone.length === 0) return [];
    this.runs = this.runs.filter((run) => !gone.includes(run.id));
    this.publish();
    return gone;
  }

  /** Taken out now (Dashi stopping, or a run that never started). */
  remove(id: string): void {
    const run = this.find(id);
    if (!run) return;
    for (const entry of run.waiting) entry.resolve(null);
    this.runs = this.runs.filter((each) => each !== run);
    this.publish();
  }

  private find(id: string): Run | undefined {
    return this.runs.find((run) => run.id === id);
  }

  private showQuestion(run: Run): void {
    run.question = run.waiting[0]?.question ?? null;
  }

  private end(run: Run, phase: "done" | "failed" | "stopped", summary: string): void {
    run.phase = phase;
    run.ended = this.now();
    run.summary = phase === "done" ? summary : "";
    // A step still going when it ended didn't finish.
    for (const step of run.steps) if (step.state === "running") step.state = phase === "done" ? "done" : "failed";
    // Nothing waits on a run that ended.
    for (const entry of run.waiting.splice(0)) entry.resolve(null);
    run.question = null;
  }

  private publish(): void {
    this.snapshot = this.runs.map(
      (run): RunView => ({
        id: run.id,
        request: run.request,
        harness: run.harness,
        harnessName: run.harnessName,
        started: run.started,
        phase: run.phase,
        steps: run.steps.map((step) => ({ ...step })),
        about: run.about,
        said: run.said,
        summary: run.summary,
        error: run.error,
        question: run.question,
        session: run.session,
        ended: run.ended,
        undos: run.undos.map((entry) => ({ ...entry })),
        messages: [...run.messages],
        turn: run.turn,
      }),
    );
    for (const listener of this.listeners) listener();
  }
}
