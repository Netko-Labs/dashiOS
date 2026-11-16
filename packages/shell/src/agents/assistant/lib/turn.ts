/**
 * The turn at work: its run, where its words and steps go, how it was
 * given, and whether it goes on by itself (Keep working on it, decisions.md
 * D261). While a typed turn works in the launcher, what it must ask the
 * person (a critical step's yes, an agent's question in words) waits there
 * on one line instead of a sheet or the capsule's card (`typedGate`).
 */

import type { Question } from "../../confirm.ts";
import type { AssistantGate } from "../../lib/session/session-types.ts";
import type { PersonAnswer } from "../../presence.ts";
import type { By, Transcript } from "../transcript.ts";
import type { Hears } from "../types.ts";
import type { Running } from "./running.ts";

/** What Keep working on it adds: room for a longer job than one ask's 25 calls and two minutes. */
export const KEEP_CALLS = 200;
export const KEEP_MS = 30 * 60_000;

/** How long a question in the launcher waits for the person. */
export const LINE_SECONDS = 120;

export class Turn {
  background = false;

  constructor(
    readonly run: Running,
    readonly hears: Hears,
    readonly by: By,
    /** The capsule's own line only (not the launcher's thread): what is said in passing, as a site used the first time. */
    readonly aside: Hears = hears,
  ) {}

  keepWorking(): void {
    this.background = true;
    this.run.extend(KEEP_CALLS, KEEP_MS);
  }
}

/** The launcher's line for a typed turn's questions; nothing (the sheets, the capsule) for a spoken one or one kept working. */
export function typedGate(turn: () => Turn | null, transcript: Transcript): Pick<AssistantGate, "question" | "confirm"> {
  const typed = (): boolean => {
    const now = turn();
    return now !== null && now.by === "typing" && !now.background;
  };
  return {
    question: (text, seconds, signal) => (typed() ? transcript.ask({ text, kind: "words" }, seconds, signal) : null),
    confirm: (question: Question, signal) => {
      if (!typed()) return null;
      const words = `${question.summary.charAt(0).toUpperCase()}${question.summary.slice(1)}?`;
      return transcript
        .ask({ text: words, kind: "yes-no", yes: question.action, ...(question.danger ? { danger: true } : {}) }, LINE_SECONDS, signal)
        .then((answer: PersonAnswer) => "text" in answer && answer.text === "yes");
    },
  };
}

/** What Dashi adds after the model's own words: that it is done when the model said nothing, and the offer to undo. */
export function lastWords(run: Running, said: string, by: By = "voice"): string {
  const changed = run.steps.some((step) => step.undo && step.ok);
  const did = run.steps.length > 0 && said.trim() === "" ? (run.steps.every((step) => step.ok !== false) ? "Done." : "That didn't work.") : "";
  // Said by voice, typed in the launcher: the way back is put in the person's own way of asking.
  const back = by === "typing" ? "Type undo that to put it back." : "Say undo that to put it back.";
  return [did, changed ? back : ""].filter(Boolean).join(" ");
}
