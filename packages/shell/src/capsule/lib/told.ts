/** What 0.8's chip and tasks say, as the hub is told it: the plans that wait for a yes, and voice mode's one state. */

import type { PillAsk, VoiceModeState } from "../../shared/pill/index.ts";
import type { Chip } from "../../voice/index.ts";
import type { Task } from "./sources.ts";

/** The plans that wait for a yes: a task in phase `planned` with steps ready to run. `since` remembers when each was first seen. */
export function permissionsOf(tasks: readonly Task[], spoken: ReadonlySet<string>, since: Map<string, number>, now: number): PillAsk[] {
  return tasks.flatMap((task): PillAsk[] => {
    const steps = task.steps.filter((step) => step.state.kind === "ready").map((step) => step.title);
    if (task.phase !== "planned" || steps.length === 0) return [];
    if (!since.has(task.id)) since.set(task.id, now);
    return [{ kind: "permission", id: task.id, task: task.id, request: task.request, steps, spoken: spoken.has(task.id), since: since.get(task.id) ?? now }];
  });
}

/**
 * Voice mode's state: what the chip says first (listening, heard, the
 * answer, a notice), then a state of the capsule's own (`own`: the key down,
 * done, stopped), then a spoken task's running step.
 */
export function voiceStateOf(
  chip: Chip | null,
  own: VoiceModeState | null,
  tasks: readonly Task[],
  spoken: ReadonlySet<string>,
  noticeUntil: number,
): VoiceModeState {
  if (chip?.kind === "listening") return { phase: "listening", text: chip.text, answering: chip.question };
  if (chip?.kind === "thinking") return { phase: "heard", text: chip.text };
  if (chip?.kind === "speaking") return { phase: "answer", words: chip.words, at: chip.at, full: chip.full };
  if (chip?.kind === "notice") return { phase: "notice", line: chip.text, ...(chip.go ? { go: chip.go } : {}), until: noticeUntil };
  if (own) return own;
  const running = tasks.find((task) => task.phase === "running" && spoken.has(task.id));
  if (!running) return { phase: "idle" };
  const index = Math.max(
    0,
    running.steps.findIndex((step) => step.state.kind === "running"),
  );
  return { phase: "step", title: running.steps[index]?.title ?? "Working", index, of: running.steps.length, task: running.id };
}
