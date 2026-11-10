/**
 * A launcher run as the panel, the launcher and the notification read it
 * (store.ts keeps them): its steps, phase and question, and the words for
 * where it is. Pure.
 */

import type { HarnessId, Undo } from "../ask/index.ts";
import { cut } from "./words.ts";

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
  kind: "sign-in" | "site" | "turn" | "scopes" | "confirm" | "stuck";
  /** "Use your bodytech.com.co login?" */
  title: string;
  /** "1Password · alexk@example.com" */
  detail: string;
  choices: readonly QuestionChoice[];
  /** Short, after the run's title in the launcher and the panel: "needs your OK to sign in". */
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
  /** When it started, for a run picked up again after the shell restarted (records.ts); now when left out. */
  started?: number;
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
      // Its first line only, short: the row's detail sits beside its words.
      return run.summary ? `done · ${cut(summaryLines(run.summary).title, 40)}` : "done";
    case "failed":
      return run.error ? `stopped · ${cut(run.error.split("\n")[0] ?? "", 40)}` : "stopped";
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
