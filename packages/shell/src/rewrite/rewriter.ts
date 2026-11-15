/**
 * The function dictation calls (docs/dictation-rewrite.md): a transcript goes
 * to the model on this computer and comes back rewritten, unchanged, or with
 * the reason it did not. It never throws and never outlives its deadline. The
 * server is started when dictation is first used (`warm`), kept while it is
 * in use, and stopped after `idleMs` without a call.
 */

import { realTimers, type Timers } from "../shared/time/index.ts";
import { checkAnswer } from "./checks.ts";
import { complete, healthy } from "./lib/complete.ts";
import type { RewriteService } from "./lib/service.ts";
import { measure } from "./lib/speed.ts";
import { adviceFor, type SpeedStore, tooSlow } from "./lib/speed-store.ts";
import { rewriteMessages } from "./prompt.ts";
import type { RewriteAdvice, RewriteFailure, RewriteReply, RewriteRequest, Rewriter, RewriteState, RewriteTimings } from "./types.ts";

/** A transcript longer than this is not sent: it would not fit the model's window with its answer. */
export const WORDS_MOST = 600;
/** How long the server is kept with nothing asked of it. */
export const IDLE_MS = 10 * 60_000;
/** How long a server may take to come up before it is given up on. */
const RISE_MS = 30_000;
const POLL_MS = 100;

export interface RewriterOptions {
  /** The server, or null when there is no program or no runtime directory. */
  service: RewriteService | null;
  /** Whether tidying is on and the model's file is on this computer. */
  usable(): "ok" | "off" | "no-model";
  speed: SpeedStore;
  /** Languages (primary tags) the model is not used for. */
  offFor?: readonly string[];
  idleMs?: number;
  timers?: Timers;
  now?: () => number;
}

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

type Phase = "asleep" | "starting" | "ready";

class ModelRewriter implements Rewriter {
  private phase: Phase = "asleep";
  private rising: Promise<boolean> | null = null;
  private idle: unknown = null;
  private readonly service: RewriteService | null;
  private readonly speed: SpeedStore;
  private readonly offFor: readonly string[];
  private readonly idleMs: number;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly options: RewriterOptions) {
    this.service = options.service;
    this.speed = options.speed;
    this.offFor = options.offFor ?? [];
    this.idleMs = options.idleMs ?? IDLE_MS;
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => performance.now());
  }

  private wait(ms: number): Promise<void> {
    return new Promise((done) => this.timers.set(done, ms));
  }

  /** What `rising` gives, or false once `ms` have passed. */
  private within(rising: Promise<boolean>, ms: number): Promise<boolean> {
    return new Promise((done) => {
      const timer = this.timers.set(() => done(false), ms);
      void rising.then((up) => {
        this.timers.clear(timer);
        done(up);
      });
    });
  }

  stop = async (): Promise<void> => {
    this.timers.clear(this.idle);
    this.idle = null;
    if (this.phase === "asleep" || !this.service) return;
    this.phase = "asleep";
    this.rising = null;
    await this.service.stop();
  };

  private touch(): void {
    this.timers.clear(this.idle);
    this.idle = this.timers.set(() => void this.stop(), this.idleMs);
  }

  /** Starts the server, waits for the model, has it read the fixed part of the prompt, and times it once. */
  private async rise(service: RewriteService): Promise<boolean> {
    const { socket } = service;
    if (!(await healthy(socket)) && !(await service.start())) return false;
    const until = this.now() + RISE_MS;
    while (!(await healthy(socket))) {
      if (this.now() > until || this.phase !== "starting") return false;
      await this.wait(POLL_MS);
    }
    const prime = rewriteMessages({ transcript: "Okay.", tone: "", vocabulary: [], before: "" });
    const primed = await complete(prime, { socket, deadlineMs: RISE_MS, maxTokens: 4, timers: this.timers, now: this.now });
    if (!primed.ok) return false;
    if (this.speed.read() === null) {
      const measured = await measure(socket, this.now);
      if (measured) this.speed.write(measured);
    }
    return true;
  }

  private unusable(): "off" | "no-model" | "too-slow" | null {
    const usable = this.options.usable();
    if (usable !== "ok") return usable;
    if (!this.service) return "no-model";
    return tooSlow(this.speed.read()) ? "too-slow" : null;
  }

  warm = (): void => {
    const service = this.service;
    if (this.unusable() !== null || !service) return;
    this.touch();
    if (this.phase !== "asleep") return;
    this.phase = "starting";
    const mine = this.rise(service)
      .catch(() => false)
      .then((up) => {
        if (this.rising !== mine) return false;
        this.phase = up && !tooSlow(this.speed.read()) ? "ready" : "asleep";
        if (this.phase === "asleep") void service.stop();
        return this.phase === "ready";
      });
    this.rising = mine;
  };

  /** Why this request is not sent to the model, or null. */
  private skipped(request: RewriteRequest): { why: RewriteFailure; detail: string } | "unchanged" | null {
    const cannot = this.unusable();
    if (cannot !== null) return { why: cannot, detail: "" };
    const first = request.languages[0]?.toLowerCase().split("-")[0];
    if (first !== undefined && this.offFor.includes(first)) return { why: "off", detail: `not used for ${first}` };
    if (request.transcript.trim() === "") return "unchanged";
    return words(request.transcript) > WORDS_MOST ? { why: "refused", detail: "too long" } : null;
  }

  rewrite = async (request: RewriteRequest): Promise<RewriteReply> => {
    const started = this.now();
    const timings = (firstTokenMs: number | null = null, tokens = 0): RewriteTimings => ({ totalMs: Math.round(this.now() - started), firstTokenMs, tokens });
    const failed = (why: RewriteFailure, detail: string, firstTokenMs: number | null = null, tokens = 0): RewriteReply => ({
      kind: "failed",
      why,
      detail,
      timings: timings(firstTokenMs, tokens),
    });
    const skipped = this.skipped(request);
    const service = this.service;
    if (skipped === "unchanged") return { kind: "unchanged", timings: timings() };
    if (skipped !== null || !service) return failed(skipped?.why ?? "no-model", skipped?.detail ?? "");
    this.warm();
    if (this.phase !== "ready") {
      // Still coming up: wait for it, but never past the deadline.
      const up = await this.within(this.rising ?? Promise.resolve(false), request.deadlineMs);
      if (!up) return failed(this.unusable() ?? "starting", this.phase === "starting" ? "the model is loading" : "the server did not start");
    }
    const left = request.deadlineMs - (this.now() - started);
    if (left <= 0) return failed("deadline", "the model was still loading");
    const maxTokens = words(request.transcript) * 3 + 32;
    const done = await complete(rewriteMessages(request), {
      socket: service.socket,
      deadlineMs: left,
      maxTokens,
      signal: request.signal,
      timers: this.timers,
      now: this.now,
    });
    this.touch();
    if (!done.ok) {
      // A server that went away is started again by the next key press.
      if (done.why === "gone" && !request.signal?.aborted) this.phase = "asleep";
      return failed(done.why, done.detail, done.firstTokenMs, done.tokens);
    }
    const checked = checkAnswer(request.transcript, done.text, request.vocabulary);
    if (!checked.ok) return failed("refused", checked.check, done.firstTokenMs, done.tokens);
    if (checked.unchanged) return { kind: "unchanged", timings: timings(done.firstTokenMs, done.tokens) };
    return { kind: "text", text: checked.text, timings: timings(done.firstTokenMs, done.tokens) };
  };

  state = (): RewriteState => this.unusable() ?? this.phase;

  advice = (transcript?: string): RewriteAdvice => adviceFor(this.speed.read(), transcript === undefined ? undefined : words(transcript));
}

export function createRewriter(options: RewriterOptions): Rewriter & { stop(): Promise<void> } {
  return new ModelRewriter(options);
}
