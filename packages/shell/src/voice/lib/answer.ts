/** A launcher Ask's task, said out loud: its words, its plan read as one sentence, or why it didn't answer. */

import type { Answer, ChipGo } from "../types.ts";

/** What goes to the agent after the person's words: they were spoken, and the reply is read out. */
export const SPOKEN_CONTEXT =
  "(The person said this out loud to Dashi, and your words are read back to them in Dashi's voice: answer in one or two short plain sentences, with no lists, links, code or markup.)";

/** The part of a launcher task (agents/ask/types.ts `TaskView`) an answer is made from. */
export interface SpokenTask {
  phase: "asking" | "planned" | "running" | "done" | "failed" | "stopped";
  steps: ReadonlyArray<{ title: string }>;
  said: string;
  failure: { kind: string; text: string } | null;
}

/** What nobody answering sounds like. */
export const NO_AGENT: Answer = { say: "No agent answers yet. Choose one in Settings, under Agents.", failed: { go: "agents" } };

const sentence = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean === "" || /[.!?…]$/.test(clean) ? clean : `${clean}.`;
};

/** A plan as Dashi says it: what it would do, and that the person's Return runs it. */
export function planWords(said: string, titles: readonly string[]): string {
  const plan = titles.length === 1 ? `My plan: ${sentence(titles[0] ?? "")}` : `My plan has ${titles.length} steps: ${sentence(titles.join("; "))}`;
  return [sentence(said), plan, "Press Return in the launcher to run it."].filter(Boolean).join(" ");
}

const FAILURE_GO: Readonly<Record<string, ChipGo>> = {
  "no-key": "agents",
  "not-installed": "agents",
  "no-model": "agents",
  "not-signed-in": "launcher",
};

/** The answer a task has come to; null while it is still asking. A stopped one says nothing. */
export function answerOf(task: SpokenTask): (Answer & { plan?: true }) | null {
  switch (task.phase) {
    case "asking":
      return null;
    case "failed": {
      const go = FAILURE_GO[task.failure?.kind ?? ""];
      return { say: task.failure?.text ?? "The agent didn't answer.", failed: go ? { go } : {} };
    }
    case "stopped":
      return { say: "" };
    case "planned":
    case "running":
      return {
        say: planWords(
          task.said,
          task.steps.map((step) => step.title),
        ),
        plan: true,
      };
    case "done":
      return { say: sentence(task.said) || "I have nothing to say to that." };
  }
}
