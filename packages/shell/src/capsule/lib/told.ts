/** What 0.8's chip and tasks say, as the hub is told it: the plans that wait for a yes, and voice mode's one state. */

import { criticalTool } from "../../agents/index.ts";
import type { PillAsk, VoiceModeState } from "../../shared/pill/index.ts";
import type { Chip } from "../../voice/index.ts";
import type { Task } from "./sources.ts";

/**
 * The plans that wait for a yes: a task in phase `planned` with steps ready to run. `since` remembers when each was first seen.
 * A plan with a critical step (paying, a secret, losing work, a system change, speaking for the person: D260) is marked
 * `critical`, so it takes the tally as asking (D402); the rest wait in their card.
 */
export function permissionsOf(tasks: readonly Task[], spoken: ReadonlySet<string>, since: Map<string, number>, now: number): PillAsk[] {
  return tasks.flatMap((task): PillAsk[] => {
    const ready = task.steps.filter((step) => step.state.kind === "ready");
    if (task.phase !== "planned" || ready.length === 0) return [];
    if (!since.has(task.id)) since.set(task.id, now);
    const critical = ready.some((step) => step.tool !== undefined && criticalTool(step.tool) !== null);
    const steps = ready.map((step) => step.title);
    return [
      {
        kind: "permission",
        id: task.id,
        task: task.id,
        request: task.request,
        steps,
        spoken: spoken.has(task.id),
        since: since.get(task.id) ?? now,
        ...(critical ? { critical } : {}),
      },
    ];
  });
}

/**
 * Voice mode's state: what the chip says first (listening, heard, the
 * answer, a notice), then a state of the capsule's own (`own`: the key down,
 * done, stopped), then a spoken task's running step. "Done" goes before a
 * notice that leads nowhere, so it has its whole four seconds.
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
  // Dashi's assistant at work: its step, in Dashi's words; how many there will be is not known.
  if (chip?.kind === "working") return { phase: "step", title: chip.text, index: 0, of: 0, task: "" };
  // "Done" is not kept waiting behind a line that only repeats what was heard ("You said: Yes."): it would be gone before it was read.
  const repeats = chip?.kind === "notice" && !chip.go && own?.phase === "done";
  if (chip?.kind === "notice" && !repeats) return { phase: "notice", line: chip.text, ...(chip.go ? { go: chip.go } : {}), until: noticeUntil };
  if (own) return own;
  const running = tasks.find((task) => task.phase === "running" && spoken.has(task.id));
  // Nothing else to say, and the conversation is still open: the quiet line that says Dashi has the thread.
  if (!running) return chip?.kind === "open" ? { phase: "open" } : { phase: "idle" };
  const index = Math.max(
    0,
    running.steps.findIndex((step) => step.state.kind === "running"),
  );
  return { phase: "step", title: running.steps[index]?.title ?? "Working", index, of: running.steps.length, task: running.id };
}
