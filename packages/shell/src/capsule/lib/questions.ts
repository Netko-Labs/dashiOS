/**
 * Agents' questions (`ask_person`) that wait in the card: each is an ask on
 * the hub until it is answered (by voice, or a choice), skipped, timed out,
 * or sent to be typed elsewhere (the sheet, which has a field: nothing is
 * typed into the card).
 */

import type { PillAsk } from "../../shared/pill/index.ts";
import type { Timers } from "../../shared/time/index.ts";
import type { CardQuestion, QuestionAnswer } from "../types.ts";

interface Waiting {
  ask: Extract<PillAsk, { kind: "question" }>;
  spoken: string;
  timer: unknown;
  resolve(answer: QuestionAnswer | "elsewhere"): void;
}

export class Questions {
  private readonly waiting = new Map<string, Waiting>();
  private next = 0;

  constructor(
    private readonly timers: Timers,
    private readonly now: () => number,
    private readonly changed: () => void,
  ) {}

  /** Ask it in the card; resolves with the answer, or "elsewhere" when the person would type it. */
  ask(question: CardQuestion, signal?: AbortSignal): Promise<QuestionAnswer | "elsewhere"> {
    if (signal?.aborted) return Promise.resolve({ none: "no-answer" });
    const id = `question-${++this.next}`;
    return new Promise((resolve) => {
      const timer = this.timers.set(() => this.settle(id, { none: "no-answer" }), question.seconds * 1000);
      const ask = {
        kind: "question" as const,
        id,
        text: question.text,
        choices: question.choices ?? [],
        who: question.who,
        about: question.about ?? "",
        since: this.now(),
      };
      this.waiting.set(id, { ask, spoken: question.spoken, timer, resolve });
      signal?.addEventListener("abort", () => this.settle(id, { none: "no-answer" }), { once: true });
      this.changed();
    });
  }

  asks(): PillAsk[] {
    return [...this.waiting.values()].map((each) => each.ask);
  }

  /** What is said out loud for a question. */
  spokenOf(id: string): string {
    return this.waiting.get(id)?.spoken ?? "";
  }

  answer(id: string, answer: QuestionAnswer): void {
    this.settle(id, answer);
  }

  /** The person would type it: it goes to the sheet. */
  elsewhere(id: string): void {
    this.settle(id, "elsewhere");
  }

  private settle(id: string, answer: QuestionAnswer | "elsewhere"): void {
    const waiting = this.waiting.get(id);
    if (!waiting) return;
    this.waiting.delete(id);
    this.timers.clear(waiting.timer);
    waiting.resolve(answer);
    this.changed();
  }

  close(): void {
    for (const id of [...this.waiting.keys()]) this.settle(id, { none: "no-answer" });
  }
}
