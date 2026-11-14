/**
 * The jobs in the menu bar (docs/design.html, "Jobs in the bar"; the
 * design's b-09 to b-21), as data. A job is a launcher Ask task
 * (agents/ask), a run started from the launcher or an agent connected from
 * outside (agents/mark.ts `mergeAgents`): each is one capsule beside the
 * mark. One capsule speaks at a time: a job that needs the person first,
 * else the one whose step changed last; the others are discs. When the room
 * is short the speaking one drops its name and keeps its step, then the
 * discs that don't fit become a count. A job that needs the person is never
 * the one dropped, and never cut to a count. Pure.
 */

import type { AgentEntry, TaskView } from "../../agents/index.ts";
import type { PillAsk } from "../../shared/pill/index.ts";

/** `run`: at work (the ring turns). `need`: waits on the person (amber). `fin`: done (a tick). `off`: failed or stopped. `idle`: connected, doing nothing. */
export type JobState = "run" | "need" | "fin" | "off" | "idle";

export interface BarJob {
  /** `task:<id>`, `run:<id>` or `agent:<id>`. */
  key: string;
  kind: "task" | "agent";
  /** The task's id, or the agents' panel's focus for a run. */
  id: string;
  /** Its harness (the disc's glyph and colour); null is Dashi itself. */
  who: string | null;
  /** The job's name: the first words of what was typed, or the agent's name. */
  title: string;
  /** What it does now, in a few words. */
  step: string;
  state: JobState;
  /** The ask (`hub.asks`) that waits on the person for it, when the capsule piece has one. */
  ask?: string;
}

/** A finished job says so this long, then is a ticked disc until looked at. */
export const FIN_SPEAKS_MS = 8000;
/** The job's name is at most this long. */
export const TITLE_CHARS = 22;
/** A step in a capsule is at most this long. */
export const STEP_CHARS = 34;

/** The first words of `words`, whole, in at most `most` characters. */
export function firstWords(words: string, most: number): string {
  const one = words.replace(/\s+/g, " ").trim();
  if (one.length <= most) return one;
  const head = one.slice(0, most);
  const space = head.lastIndexOf(" ");
  return (space > most / 3 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, "");
}

const capital = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

/** A task still in sight: asking, waiting for a yes, running, failed just now, or done and not yet looked at. */
export function taskShows(task: TaskView, seen: ReadonlySet<string>): boolean {
  if (task.phase === "asking" || task.phase === "planned" || task.phase === "running") return true;
  if (task.phase === "failed") return task.leftNow !== true;
  return task.phase === "done" && !seen.has(task.id);
}

function taskStep(task: TaskView): { step: string; state: JobState } {
  switch (task.phase) {
    case "asking":
      return { step: "Thinking", state: "run" };
    case "planned":
      return { step: "needs you", state: "need" };
    case "running":
      return { step: firstWords(task.steps.find((step) => step.state.kind === "running")?.title ?? "Working", STEP_CHARS), state: "run" };
    case "done":
      return { step: "done", state: "fin" };
    case "failed":
      return { step: "didn’t answer", state: "off" };
    default:
      return { step: "stopped", state: "off" };
  }
}

/** The Ask tasks in sight as jobs, the oldest first (the store keeps the newest first). */
export function taskJobs(tasks: readonly TaskView[], asks: readonly PillAsk[], seen: ReadonlySet<string>): BarJob[] {
  return tasks
    .filter((task) => taskShows(task, seen))
    .map((task): BarJob => {
      const ask = asks.find((each) => each.kind === "permission" && each.task === task.id);
      const { step, state } = taskStep(task);
      return {
        key: `task:${task.id}`,
        kind: "task",
        id: task.id,
        // A harness answers as itself; a model answers as Dashi.
        who: task.answerer.id === "claude-code" || task.answerer.id === "codex" || task.answerer.id === "opencode" ? task.answerer.id : null,
        title: capital(firstWords(task.request, TITLE_CHARS)),
        step: ask ? "needs you" : step,
        state: ask ? "need" : state,
        ...(ask ? { ask: ask.id } : {}),
      };
    })
    .reverse();
}

/** Runs from the launcher and agents connected from outside as jobs, the oldest first. */
export function agentJobs(entries: readonly AgentEntry[]): BarJob[] {
  return [...entries]
    .sort((a, b) => a.since - b.since)
    .map(
      (entry): BarJob => ({
        key: entry.key,
        kind: "agent",
        id: entry.run?.id ?? entry.key,
        who: entry.harness,
        title: entry.run ? capital(firstWords(entry.run.request, TITLE_CHARS)) : entry.name,
        step: entry.phase === "waiting" ? "needs you" : firstWords(entry.doing, STEP_CHARS),
        state: entry.phase === "waiting" ? "need" : entry.phase === "working" ? "run" : "idle",
      }),
    );
}

/** When each job's step last changed (the shell's clock), by its key. */
export type JobStamps = ReadonlyMap<string, { said: string; at: number }>;

/** The stamps after `jobs` are seen at `now`: a job whose state or step changed is stamped again; jobs that went are forgotten. */
export function stampJobs(before: JobStamps, jobs: readonly BarJob[], now: number): JobStamps {
  const after = new Map<string, { said: string; at: number }>();
  for (const job of jobs) {
    const said = `${job.state}\n${job.step}`;
    const was = before.get(job.key);
    after.set(job.key, was && was.said === said ? was : { said, at: now });
  }
  return after;
}

/**
 * The job that speaks: the oldest that needs the person; else the one whose
 * step changed last among those at work and those that finished or failed
 * within `FIN_SPEAKS_MS`. Null when nobody has anything to say.
 */
export function speaker(jobs: readonly BarJob[], stamps: JobStamps, now: number): string | null {
  const needy = jobs.find((job) => job.state === "need");
  if (needy) return needy.key;
  let best: { key: string; at: number } | null = null;
  for (const job of jobs) {
    if (job.state === "idle") continue;
    const at = stamps.get(job.key)?.at ?? 0;
    if ((job.state === "fin" || job.state === "off") && now - at >= FIN_SPEAKS_MS) continue;
    if (!best || at >= best.at) best = { key: job.key, at };
  }
  return best?.key ?? null;
}

/** When the speaking has to be worked out again by itself (a finished job falls silent); null when nothing is pending. */
export function nextSilence(jobs: readonly BarJob[], stamps: JobStamps, now: number): number | null {
  const ends = jobs
    .filter((job) => job.state === "fin" || job.state === "off")
    .map((job) => (stamps.get(job.key)?.at ?? 0) + FIN_SPEAKS_MS)
    .filter((end) => end > now);
  return ends.length > 0 ? Math.min(...ends) : null;
}

/** The capsule's measures (docs/design.html, "Jobs in the bar"). */
export const CAPSULE = { height: 20, ring: 16, disc: 12, glyph: 8, gap: 5, left: 2, right: 9, fontSize: 11.5, between: 4, char: 6.1 } as const;

/** How a job is drawn: its name and step, its step alone, or its disc. */
export type CapsuleForm = "full" | "step" | "disc";

export interface JobRow {
  /** Left to right: the speaking one is the last, against the mark. */
  capsules: { job: BarJob; form: CapsuleForm }[];
  /** Jobs that did not fit: "+N", left of the capsules. 0 for none. */
  more: number;
}

const DISC_WIDTH = CAPSULE.height;
const wordsWidth = (words: string): number => CAPSULE.left + CAPSULE.ring + CAPSULE.gap + Math.ceil(words.length * CAPSULE.char) + CAPSULE.right;
/** "+N"'s room. */
export const MORE_JOBS_WIDTH = 30;

/** A capsule's width as it is taken to be before it is drawn. */
export function capsuleWidth(job: BarJob, form: CapsuleForm): number {
  if (form === "disc") return DISC_WIDTH;
  return wordsWidth(form === "full" ? `${job.title} ${job.step}` : capital(job.step));
}

const rowWidth = (widths: readonly number[]): number => widths.reduce((sum, width) => sum + width, 0) + CAPSULE.between * Math.max(0, widths.length - 1);

/**
 * The jobs' row in `room` (null: not measured yet, everything shows). The
 * speaking capsule stands last. It is drawn whole when that fits; else with
 * its step alone; else as a disc. Then discs go into "+N", the oldest
 * first, but never one that needs the person, and never the speaking one.
 */
export function layoutJobs(jobs: readonly BarJob[], speaking: string | null, room: number | null): JobRow {
  const voice = jobs.find((job) => job.key === speaking) ?? null;
  const quiet = jobs.filter((job) => job !== voice);
  const row = (form: CapsuleForm, shown: readonly BarJob[], more: number): JobRow => ({
    capsules: [...shown.map((job) => ({ job, form: "disc" as const })), ...(voice ? [{ job: voice, form }] : [])],
    more,
  });
  const fits = (form: CapsuleForm, shown: readonly BarJob[], more: number): boolean =>
    room === null || rowWidth([...(more > 0 ? [MORE_JOBS_WIDTH] : []), ...shown.map(() => DISC_WIDTH), ...(voice ? [capsuleWidth(voice, form)] : [])]) <= room;
  for (const form of ["full", "step"] as const) if (fits(form, quiet, 0)) return row(form, quiet, 0);
  // Short of room: the discs go, the oldest first, the ones that need the person last of all (and then never).
  const shown = [...quiet];
  let more = 0;
  const form: CapsuleForm = voice?.state === "need" ? "step" : "disc";
  while (!fits(form, shown, more)) {
    const at = shown.findIndex((job) => job.state !== "need");
    if (at < 0) break;
    shown.splice(at, 1);
    more++;
  }
  return row(form, shown, more);
}

/** What a screen reader says for a job. */
export function jobLabel(job: BarJob): string {
  const who = job.who === null ? "" : `${job.who === "claude-code" ? "Claude Code" : job.who === "codex" ? "Codex" : "OpenCode"}, `;
  return `${who}${job.title}: ${job.step}`;
}

/** How many jobs wait on the person: what the mark counts, with the capsule piece's asks when it has more. */
export function needCount(jobs: readonly BarJob[], asks: readonly PillAsk[]): number {
  return Math.max(asks.length, jobs.filter((job) => job.state === "need").length);
}
