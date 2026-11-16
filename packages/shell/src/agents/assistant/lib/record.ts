/**
 * What a turn leaves when it ends: the exchange in the conversation (and its
 * file), the steps in the launcher's history with what would undo them, the
 * one log line (with the model: `model="Claude Code · opus"`, so turns can
 * be compared), and, for a turn kept working on its own, the notification;
 * for a typed one with "Read typed answers aloud" on, the words said.
 */

import type { Conversation } from "../conversation.ts";
import type { AssistantOptions, SpokenAnswer } from "../types.ts";
import type { Running } from "./running.ts";
import type { Turn } from "./turn.ts";

export interface Ended {
  said: string;
  answer: SpokenAnswer;
  interrupted: boolean;
  turn: Turn;
  label: string;
  way: string;
}

interface RecordDeps {
  options: AssistantOptions;
  talk: Conversation;
  now: number;
  /** This ask's number, for its history line's id. */
  serial: number;
}

function keepHistory({ options, talk, now, serial }: RecordDeps, id: string, words: string, run: Running): void {
  if (run.steps.length === 0) return;
  for (const step of run.steps) if (step.undo && step.ok) talk.undos.push({ undo: step.undo, undone: false });
  options.history?.add({
    task: `talk-${id}.${serial}`,
    time: Math.floor(now / 1000),
    agent: options.name(),
    request: words,
    steps: run.steps.map((step) => ({
      title: step.title,
      outcome: step.ok === false ? ("failed" as const) : ("done" as const),
      ...(step.undo && step.ok ? { undo: step.undo } : {}),
    })),
  });
}

export function finishTurn(deps: RecordDeps, id: string, words: string, run: Running, end: Ended): void {
  const { options, talk, now } = deps;
  const { said, answer, interrupted, turn, label, way } = end;
  const steps = run.steps.map((step) => step.title);
  const all = [said.trim(), answer.failed ? "" : answer.say].filter(Boolean).join(" ");
  talk.record(id, { time: now, asked: words, said: all, steps, ...(interrupted ? { interrupted: true as const } : {}) });
  keepHistory(deps, id, words, run);
  // A notification is one glance: the conclusion, the last paragraph of what was said.
  const conclusion =
    all
      .split(/\n\s*\n/)
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? "";
  if (turn.background) options.done?.(interrupted ? "Stopped" : answer.failed ? "That didn't work" : "Done", conclusion || words);
  else if (turn.by === "typing" && all && options.settings().agents.readTyped === true) options.speak?.(all);
  const ended = interrupted ? "stopped" : (run.stopped ?? (answer.failed ? "failed" : "done"));
  options.log?.(
    `assistant asked=${JSON.stringify(words.slice(0, 80))} by=${turn.by} way=${way} model=${JSON.stringify(label)} calls=${steps.length} ended=${ended}${turn.background ? " background" : ""}`,
  );
}
