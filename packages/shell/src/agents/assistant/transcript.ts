/**
 * The conversation as the launcher shows it (decisions.md D261): every turn,
 * spoken or typed, in order: the person's words, then Dashi's step lines and
 * its words as they are written. One transcript for the one conversation, so
 * a conversation started by voice shows its spoken turns when the launcher
 * opens, and a typed one goes on by voice. It starts again with a new
 * conversation. It also holds the one question that waits on the person in
 * the launcher (a critical step's Yes and No, or an agent's question in
 * words), while the turn that asked was typed.
 */

import type { PersonAnswer } from "../presence.ts";

/** How a turn was given. */
export type By = "voice" | "typing";

export interface TurnStep {
  title: string;
  /** null while it runs. */
  ok: boolean | null;
}

export interface PersonTurn {
  kind: "person";
  id: number;
  text: string;
  by: By;
  time: number;
}

export interface DashiTurn {
  kind: "dashi";
  id: number;
  by: By;
  text: string;
  steps: TurnStep[];
  state: "working" | "done" | "stopped" | "failed";
  /** The model it was answered with ("Claude Code · Opus"). */
  model: string;
  /** What failed and the one thing to do, when it failed. */
  failed?: { go?: "voice" | "agents" | "launcher" };
}

export type Turn = PersonTurn | DashiTurn;

/** A question waiting in the launcher: yes or no (a critical step), or words. */
export interface Waiting {
  id: number;
  text: string;
  kind: "yes-no" | "words";
  /** Words for the yes button ("Force Quit"); "Yes" unless set. */
  yes?: string;
  danger?: boolean;
}

export interface TranscriptView {
  conversation: string | null;
  turns: readonly Turn[];
  /** A turn is being answered now. */
  working: boolean;
  /** It goes on by itself, the launcher may close (Keep working on it). */
  background: boolean;
  waiting: Waiting | null;
}

const EMPTY: TranscriptView = { conversation: null, turns: [], working: false, background: false, waiting: null };

/** What a turn being answered writes to. */
export interface TurnPen {
  say(text: string): void;
  step(title: string): void;
  settle(ok: boolean): void;
  end(state: DashiTurn["state"], extra?: { text?: string; failed?: DashiTurn["failed"] }): void;
}

export class Transcript {
  private view: TranscriptView = EMPTY;
  private next = 0;
  private answer: ((answer: PersonAnswer) => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): TranscriptView => this.view;

  /** The person said or typed `text` in conversation `conversation`: a new conversation starts the transcript again. */
  begin(conversation: string, text: string, by: By, model: string): TurnPen {
    const fresh = this.view.conversation !== conversation;
    const asked: PersonTurn = { kind: "person", id: ++this.next, text, by, time: this.now() };
    const answer: DashiTurn = { kind: "dashi", id: ++this.next, by, text: "", steps: [], state: "working", model };
    this.set({ ...(fresh ? EMPTY : this.view), conversation, turns: [...(fresh ? [] : this.view.turns), asked, answer], working: true, waiting: null });
    const edit = (change: (turn: DashiTurn) => DashiTurn) =>
      this.set({ ...this.view, turns: this.view.turns.map((turn) => (turn.id === answer.id && turn.kind === "dashi" ? change(turn) : turn)) });
    return {
      say: (more) => edit((turn) => ({ ...turn, text: turn.text + more })),
      step: (title) => edit((turn) => ({ ...turn, steps: [...turn.steps, { title, ok: null }] })),
      settle: (ok) =>
        edit((turn) => {
          const at = turn.steps.findLastIndex((step) => step.ok === null);
          return at < 0 ? turn : { ...turn, steps: turn.steps.map((step, index) => (index === at ? { ...step, ok } : step)) };
        }),
      end: (state, extra = {}) => {
        edit((turn) => ({
          ...turn,
          state,
          // A failure says only why, in Dashi's words: what was printed before it (a harness's "Not logged in") is not an answer.
          text:
            state === "failed" && extra.text
              ? extra.text.trim()
              : [turn.text.trim(), extra.text?.trim() ?? ""].filter(Boolean).join(turn.text.trim() ? " " : ""),
          steps: turn.steps.map((step) => (step.ok === null ? { ...step, ok: state === "done" } : step)),
          ...(extra.failed ? { failed: extra.failed } : {}),
        }));
        this.drop();
        this.set({ ...this.view, working: false, background: false });
      },
    };
  }

  /** Keep working on it: the turn goes on by itself. */
  setBackground(on: boolean): void {
    if (this.view.working && this.view.background !== on) this.set({ ...this.view, background: on });
  }

  /** The conversation ended: what it showed stays until the next one begins, with nothing waiting. */
  ended(): void {
    this.drop();
  }

  /** Ask in the launcher; resolves with the person's answer, or none when `signal` gives it up or `seconds` pass. */
  ask(question: Omit<Waiting, "id">, seconds: number, signal: AbortSignal): Promise<PersonAnswer> {
    this.drop();
    return new Promise((resolve) => {
      const none = () => settle({ none: "no-answer" });
      const timer = setTimeout(none, seconds * 1000);
      const settle = (answer: PersonAnswer) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", none);
        if (this.answer === settle) this.answer = null;
        this.set({ ...this.view, waiting: null });
        resolve(answer);
      };
      if (signal.aborted) return none();
      signal.addEventListener("abort", none, { once: true });
      this.answer = settle;
      this.set({ ...this.view, waiting: { ...question, id: ++this.next } });
    });
  }

  /** The person answered the question in the launcher: Yes or No pressed, Return, or words typed. */
  reply(answer: PersonAnswer): boolean {
    if (!this.answer) return false;
    this.answer(answer);
    return true;
  }

  private drop(): void {
    this.answer?.({ none: "no-answer" });
  }

  private set(view: TranscriptView): void {
    this.view = view;
    for (const listener of [...this.listeners]) listener();
  }
}
