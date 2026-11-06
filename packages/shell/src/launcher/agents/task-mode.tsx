/**
 * The launcher on an Ask's plan: what its one chrome row says, and what
 * Return does (docs/betterments.html: "Return runs exactly those calls; Esc
 * cancels; ⇥ edits the request"). Pure, apart from the re-exported view.
 *
 * - The field's glyph is the shiso spark; the chip is the request; the field
 *   takes a follow-up, which continues the conversation.
 * - Return: a follow-up when words are typed; else the selected step's act
 *   ("Allow once", Undo); else run the plan, try again, or open Settings when
 *   a key or a model is missing.
 */

import { oneLine } from "../../agents/ask/plan.ts";
import type { TaskView } from "../../agents/ask/tasks.ts";
import { SPARKLE } from "../../settings-app/glyphs.ts";
import type { Hint } from "../verbs.ts";
import { needsSettings, stepAct } from "./plan-view.tsx";

export { PlanList, stepAct } from "./plan-view.tsx";

export type TaskSubmit =
  | { kind: "follow-up"; text: string }
  | { kind: "run" }
  | { kind: "allow-once"; step: number }
  | { kind: "undo"; step: number }
  | { kind: "retry" }
  | { kind: "settings" }
  | { kind: "none" };

/** What Return does on `task`, with `draft` in the field and step `step` selected. */
export function taskSubmit(task: TaskView, draft: string, step: number | null): TaskSubmit {
  const busy = task.phase === "asking" || task.phase === "running";
  if (draft.trim() && !busy) return { kind: "follow-up", text: draft.trim() };
  const selected = step === null ? undefined : task.steps[step];
  const act = selected ? stepAct(selected) : null;
  if (act === "allow-once" && step !== null && !busy) return { kind: "allow-once", step };
  if (act === "undo" && step !== null) return { kind: "undo", step };
  if (task.phase === "planned") return { kind: "run" };
  if (task.phase === "failed") return needsSettings(task.failure) ? { kind: "settings" } : { kind: "retry" };
  return { kind: "none" };
}

/** How many steps Return runs now. */
const toRun = (task: TaskView): number => task.steps.filter((step) => step.state.kind === "ready" || step.state.kind === "not-allowed").length;

/** The field row on a plan: glyph, chip, placeholder, and the keys at its right end. */
export function agentField(
  task: TaskView | undefined,
  draft: string,
  agentColor: string,
): { glyph: { markup: string; color: string }; chip?: { title: string }; placeholder: string; hints: Hint[] } {
  const glyph = { markup: SPARKLE, color: agentColor };
  if (!task) return { glyph, placeholder: "This request has ended", hints: [{ keys: "Esc", label: "back" }] };
  const chip = { title: oneLine(task.request, 40) };
  const placeholder = `Follow up with ${task.answerer.name}`;
  const busy = task.phase === "asking" || task.phase === "running";
  const hints: Hint[] =
    draft.trim() && !busy
      ? [{ keys: "↩", label: "Follow up" }]
      : task.phase === "planned" && toRun(task) > 0
        ? [{ keys: "↩", label: `Run ${toRun(task)}` }]
        : task.phase === "failed"
          ? [{ keys: "↩", label: needsSettings(task.failure) ? "Settings" : "Retry" }]
          : [];
  return { glyph, chip, placeholder, hints: [...hints, { keys: "⇥", label: "Edit" }, { keys: "Esc", label: "back" }] };
}
