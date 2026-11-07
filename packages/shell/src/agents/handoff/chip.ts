/**
 * The menu bar's one chip while agents from the launcher work (docs/actions.md,
 * "Agents from the launcher"): the newest one's words ("Claude Code ·
 * Signing in to bodytech.com.co"), "2 agents · Claude Code is signing in"
 * with more, and amber, "Claude Code needs you", while one waits on the
 * person. No chip when none works. Pure.
 */

import { currentStep, isWorking, type RunView } from "./store.ts";
import { lowerFirst } from "./words.ts";

export interface ChipState {
  words: string;
  /** One waits on the person: the chip is amber. */
  attention: boolean;
  /** Agents working. */
  count: number;
  /** The run the chip speaks for (the panel opens on it). */
  run: string;
}

/** What one run is doing, after its harness's name: "Opening x", or "Starting". */
const doing = (run: RunView): string => currentStep(run)?.words ?? (run.steps.length === 0 && run.phase === "starting" ? "Starting" : "Thinking");

export function chipState(runs: readonly RunView[]): ChipState | null {
  const working = runs.filter(isWorking).sort((a, b) => b.started - a.started);
  const newest = working[0];
  if (!newest) return null;
  const waiting = working.find((run) => run.question !== null);
  const count = working.length;
  if (waiting) {
    const words = `${waiting.harnessName} needs you`;
    return { words: count > 1 ? `${count} agents · ${words}` : words, attention: true, count, run: waiting.id };
  }
  const words = count > 1 ? `${count} agents · ${newest.harnessName} is ${lowerFirst(doing(newest))}` : `${newest.harnessName} · ${doing(newest)}`;
  return { words, attention: false, count, run: newest.id };
}
