/**
 * One ask at work (decisions.md D148): what it has done, in Dashi's words,
 * and the limits it is held to. An ask may make 25 calls and take two
 * minutes of its own time (the time a call waits on the person is theirs);
 * then it stops and says where it is. The agents' server tells it of every
 * call through the launcher runs' hooks (`before`, `after`) and asks it
 * whether a call may start (`refuses`), so both ways of driving the tools
 * are held the same way.
 */

import type { Timers } from "../../../shared/time/index.ts";
import type { Undo } from "../../ask/index.ts";
import type { Call } from "../../tools/index.ts";
import { stepWords, WAITS_ON_PERSON } from "./steps.ts";

/** The most calls one ask makes. */
export const MAX_CALLS = 25;
/** The most of its own time one ask takes. */
export const MAX_MS = 120_000;
/** Calls refused past the cap before the ask is stopped: the model was told to stop and went on. */
const PATIENCE = 3;

/** What the model is told at the cap: it then says where it is, in its own sentence. */
export const CAP_WORDS = `That was ${MAX_CALLS} steps, the most one request takes. Make no more calls: tell the person in one sentence how far you got, and that they can ask you to go on.`;

export interface Step {
  title: string;
  /** How it went; null while it runs. */
  ok: boolean | null;
  /** It waits on the person (a question, a sign-in): its time is theirs. */
  waits: boolean;
  undo?: Undo;
}

export interface RunningDeps {
  timers: Timers;
  now(): number;
  /** The capsule's line. */
  step(title: string): void;
  /** What would put a settings change back; null for anything else. */
  undoOf(call: Call): Undo | null;
  maxCalls?: number;
  maxMs?: number;
}

export class Running {
  readonly steps: Step[] = [];
  /** Why Dashi stopped it itself; null when it ended by itself or the person stopped it. */
  stopped: "time" | "calls" | null = null;
  private calls = 0;
  private over = 0;
  private left: number;
  private since = 0;
  private timer: unknown = null;
  private waiting = 0;
  private readonly controller = new AbortController();

  constructor(
    private readonly deps: RunningDeps,
    outer: AbortSignal,
  ) {
    this.left = deps.maxMs ?? MAX_MS;
    outer.addEventListener("abort", () => this.controller.abort(), { once: true });
    if (outer.aborted) this.controller.abort();
    this.run();
  }

  /** Aborted when the person stops it, or at a limit. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** The last thing it did, in Dashi's words; "" when it did nothing. */
  get last(): string {
    return this.steps.at(-1)?.title ?? "";
  }

  /** Why a call may not start now, in words for the model; null when it may (and it counts). */
  refuses(): string | null {
    if (this.controller.signal.aborted) return "The person stopped this. Make no more calls.";
    if (this.calls < (this.deps.maxCalls ?? MAX_CALLS)) {
      this.calls++;
      return null;
    }
    if (++this.over > PATIENCE) this.halt("calls");
    return CAP_WORDS;
  }

  /** A call starts: its line in the capsule, and what would undo it. */
  before(call: Call): Undo | null {
    const undo = this.deps.undoOf(call);
    const step: Step = { title: stepWords(call), ok: null, waits: WAITS_ON_PERSON.has(call.name), ...(undo ? { undo } : {}) };
    this.steps.push(step);
    this.deps.step(step.title);
    // The person's own time (a question, a sign-in, a hand-over) is not the ask's.
    if (step.waits && this.waiting++ === 0) this.pause();
    return undo;
  }

  /** The call that started last ended. */
  after(ok: boolean): void {
    const step = this.steps.findLast((each) => each.ok === null);
    if (!step) return;
    step.ok = ok;
    if (step.waits && --this.waiting === 0) this.run();
  }

  private run(): void {
    this.since = this.deps.now();
    this.timer = this.deps.timers.set(() => this.halt("time"), Math.max(0, this.left));
  }

  private pause(): void {
    if (this.timer !== null) this.deps.timers.clear(this.timer);
    this.timer = null;
    this.left -= this.deps.now() - this.since;
  }

  private halt(why: "time" | "calls"): void {
    if (this.controller.signal.aborted) return;
    this.stopped = why;
    this.controller.abort();
  }

  /** It is over: its clock stops. */
  end(): void {
    if (this.timer !== null) this.deps.timers.clear(this.timer);
    this.timer = null;
  }
}

/** What Dashi says when it stopped an ask itself: where it is. */
export function stoppedWords(running: Running): string {
  const where = running.last ? ` I got as far as: ${running.last.charAt(0).toLowerCase()}${running.last.slice(1)}.` : "";
  return running.stopped === "time"
    ? `I ran out of time.${where} Ask me to go on if you want.`
    : `I stopped after ${MAX_CALLS} steps.${where} Ask me to go on if you want.`;
}
