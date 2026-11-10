/**
 * The agents' history you can read (docs/betterments.html, "History you can
 * read"): what agents did, grouped by task, newest first, for "history" in
 * the launcher and the list in Settings › Agents.
 *
 * Two files in `$XDG_STATE_HOME/dashi/agents/`:
 * - activity.jsonl, one line per call, with no arguments (consent.ts): an
 *   MCP agent's calls are grouped by connection (a session ends at its
 *   "disconnected" or "stopped" line), the person's own ("you") are left out;
 *   one agent's connections in quick succession are one row (sessions.ts).
 * - tasks.jsonl, written here: one line per launcher Ask once its plan ran
 *   (or once it failed, with why: no steps), with the request, each step in Dashi's words and how it went, and for a
 *   settings change the value to put back (Undo); and a line when one was
 *   undone. The request is what the person typed; the arguments are only
 *   ever the steps' own words.
 */

import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../consent.ts";
import { callsSummary, groupSessions } from "./lib/sessions.ts";
import type { Undo } from "./plan.ts";

export type StepOutcome = "done" | "not-allowed" | "failed" | "invalid" | "skipped";

export interface HistoryStep {
  title: string;
  outcome: StepOutcome;
  undo?: Undo;
  undone?: boolean;
}

export interface HistoryEntry {
  /** A launcher task's id, or `session:<n>` for an agent's connection. */
  id: string;
  /** When it began, in seconds. */
  time: number;
  /** Who did it: the answerer ("Claude"), or the agent's process name. */
  who: string;
  /** What the person asked, for a launcher task. */
  request?: string;
  steps: HistoryStep[];
  /** One line: "Dark Mode on, Dock hidden", "12 calls over 4 min: list windows, screenshot". */
  summary: string;
  /** Still connected (no end line yet). */
  open?: boolean;
  /** An agent's last call, in seconds. */
  end?: number;
  /** An agent's calls, in words ("list windows"), in order. */
  tools?: string[];
  /**
   * An agent's connections close together, as one row (sessions.ts): each
   * of them, oldest first, for Settings to list when the row is opened.
   */
  parts?: HistoryEntry[];
}

/** One finished launcher task, as tasks.jsonl keeps it. */
export interface TaskRecord {
  task: string;
  time: number;
  agent: string;
  request: string;
  steps: HistoryStep[];
  /** Why there was no plan to run ("Claude Code didn't answer."): an ask that failed is kept too. */
  failure?: string;
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const OUTCOMES: readonly StepOutcome[] = ["done", "not-allowed", "failed", "invalid", "skipped"];

function lines(text: string): Raw[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const value: unknown = JSON.parse(line);
      return isRaw(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

function readUndo(value: unknown): Undo | undefined {
  if (!isRaw(value) || typeof value.address !== "string" || !isRaw(value.args) || typeof value.title !== "string") return undefined;
  return { address: value.address, args: value.args, title: value.title };
}

function readSteps(value: unknown): HistoryStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step): HistoryStep[] => {
    if (!isRaw(step) || typeof step.title !== "string") return [];
    const outcome = OUTCOMES.find((each) => each === step.outcome) ?? "failed";
    const undo = readUndo(step.undo);
    return [{ title: step.title, outcome, ...(undo ? { undo } : {}) }];
  });
}

/** Text from the file on one short line. */
const oneLineOf = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
};

/** "list_windows" as words. */
const toolWords = (tool: string): string => tool.replace(/^dashi:\/\/[^/]+\//, "").replace(/[_-]+/g, " ");

/** A launcher task's one line: what was done, or what wasn't. */
export function taskSummary(steps: readonly HistoryStep[]): string {
  const done = steps.filter((step) => step.outcome === "done");
  if (steps.length === 0) return "No steps";
  if (done.length === steps.length) return steps.map((step) => step.title).join(", ");
  return `${done.length} of ${steps.length} done`;
}

/** Every task and session in the two files, newest first, at most `limit`. */
export function readHistory(files: { tasks: string; activity: string }, limit = 30): HistoryEntry[] {
  const entries = new Map<string, HistoryEntry>();
  for (const line of lines(files.tasks)) {
    if (typeof line.task !== "string" || typeof line.time !== "number") continue;
    if (typeof line.undone === "number") {
      const step = entries.get(line.task)?.steps[line.undone];
      if (step) step.undone = true;
      continue;
    }
    if (typeof line.agent !== "string" || typeof line.request !== "string") continue;
    const steps = readSteps(line.steps);
    // A failed ask says why in its summary; the line of the plan that came after (a Retry) replaces it.
    const failed = typeof line.failure === "string" && steps.length === 0 ? oneLineOf(line.failure) : "";
    entries.set(line.task, { id: line.task, time: line.time, who: line.agent, request: line.request, steps, summary: failed });
  }
  // The agents' connections: calls between one agent's first call and its end line.
  const open = new Map<string, HistoryEntry>();
  const calls = new Map<HistoryEntry, string[]>();
  let sessions = 0;
  for (const line of lines(files.activity)) {
    if (typeof line.agent !== "string" || line.agent === "you" || typeof line.time !== "number" || typeof line.task === "string") continue;
    const ended = line.tool === null && (line.outcome === "disconnected" || line.outcome === "stopped");
    const current = open.get(line.agent);
    if (ended) {
      if (current) {
        current.open = false;
        open.delete(line.agent);
      }
      continue;
    }
    if (typeof line.tool !== "string") continue;
    const session = current ?? { id: `session:${++sessions}`, time: line.time, who: line.agent, steps: [], summary: "", open: true };
    if (!current) {
      open.set(line.agent, session);
      entries.set(session.id, session);
    }
    session.end = line.time;
    const tools = calls.get(session);
    if (tools) tools.push(line.tool);
    else calls.set(session, [line.tool]);
  }
  for (const entry of entries.values()) {
    const tools = calls.get(entry);
    if (tools) {
      entry.tools = tools.map(toolWords);
      entry.summary = callsSummary(entry.tools, entry.time, entry.end ?? entry.time);
    } else if (!entry.summary) {
      entry.summary = taskSummary(entry.steps);
    }
  }
  // An agent that connects for each call (a remote agent's every command) is one row, not a column of "1 call".
  return groupSessions([...entries.values()].sort((a, b) => a.time - b.time))
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(time: number, now: number): string {
  const seconds = Math.max(0, now - time);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86_400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** The last `bytes` of a file, from its first whole line; empty when there is none. */
function tail(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    return start === 0 ? text : text.slice(text.indexOf("\n") + 1);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

const TAIL_BYTES = 512 * 1024;

/** The history on disk: read when asked (the launcher's "history", Settings), written as tasks finish. */
export class HistoryLog {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly dir: string = stateDir()) {}

  read(limit = 30): HistoryEntry[] {
    return readHistory({ tasks: tail(join(this.dir, "tasks.jsonl"), TAIL_BYTES), activity: tail(join(this.dir, "activity.jsonl"), TAIL_BYTES) }, limit);
  }

  add(record: TaskRecord): void {
    this.append({ v: 1, ...record });
  }

  /** Step `step` of `task` was taken back. */
  undone(task: string, step: number): void {
    this.append({ v: 1, time: Math.floor(Date.now() / 1000), task, undone: step });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private append(line: Raw): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(join(this.dir, "tasks.jsonl"), `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (error) {
      console.error("dashi-shell: could not keep the agents' history:", error);
    }
    for (const listener of this.listeners) listener();
  }
}
