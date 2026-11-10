/**
 * A run on disk, so a shell that restarts picks its runs up again
 * (docs/actions.md, "Agents from the launcher"): the run goes on as its
 * user service whatever the shell does, and its card comes back from
 * `run.json` beside its streams in `$XDG_RUNTIME_DIR/dashi-agents/<run>/`
 * and from the streams themselves, read again from the start. The record
 * holds what the streams don't: the request (the card's title), the
 * harness, when it started, its turn, unit and stream, the words sent to it
 * since, the window its context chip named, the sites allowed for the task,
 * what Undo puts back, and whether the person stopped it or was told it
 * ended. Never a secret: the context's text and the prompt stay out of it.
 *
 * Pure: parsing a record, the systemd units listed, and which harness wrote
 * a stream when there is no record (a run an older shell started).
 */

import { HARNESS_IDS, type HarnessId, isHarnessId } from "../../ask/answerer.ts";
import type { Undo } from "../../ask/plan.ts";
import type { RunMessage, RunView } from "../run-view.ts";
import { streamEvents } from "./stream.ts";

export const RECORD_VERSION = 1;

export interface RunRecord {
  v: typeof RECORD_VERSION;
  id: string;
  /** The person's words: the card's title. */
  request: string;
  harness: HarnessId;
  started: number;
  turn: number;
  /** Its turn's unit, `dashi-task-<run>-<turn>.service`. */
  unit: string;
  /** Its turn's stream. */
  log: string;
  /** Words sent to it after it started, one a turn from the second. */
  messages: RunMessage[];
  /** The window its context chip named (for `hand_over`). */
  window: number | null;
  /** The sites allowed for this task. */
  sites: string[];
  undos: Array<{ undo: Undo; undone: boolean }>;
  /** The turn the person stopped, if they did. */
  stopped: number | null;
  /** The turn whose end the person was told of (the done notification). */
  told: number | null;
}

/** What goes into a run's record besides what the store has. */
export interface RecordExtra {
  unit: string;
  log: string;
  window: number | null;
  sites: Iterable<string>;
  stopped: number | null;
  told: number | null;
}

export function recordOf(run: RunView, extra: RecordExtra): RunRecord {
  return {
    v: RECORD_VERSION,
    id: run.id,
    request: run.request,
    harness: run.harness,
    started: run.started,
    turn: run.turn,
    unit: extra.unit,
    log: extra.log,
    messages: run.messages.map((message) => ({ ...message })),
    window: extra.window,
    sites: [...extra.sites].sort(),
    undos: run.undos.map((entry) => ({ undo: entry.undo, undone: entry.undone })),
    stopped: extra.stopped,
    told: extra.told,
  };
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
/** A run's id as its scope's name needs it (sandbox.ts `taskOfCgroup`). */
export const isRunId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{4,24}$/.test(value);

function undoOf(value: unknown): { undo: Undo; undone: boolean } | null {
  if (!isRaw(value) || !isRaw(value.undo)) return null;
  const { address, args, title } = value.undo;
  if (typeof address !== "string" || !isRaw(args) || typeof title !== "string") return null;
  return { undo: { address, args: args as Undo["args"], title }, undone: value.undone === true };
}

/** A record from its JSON; null when it doesn't parse or isn't one (a file is untrusted). */
export function parseRecord(text: string): RunRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRaw(value) || value.v !== RECORD_VERSION || !isRunId(value.id) || !isHarnessId(value.harness)) return null;
  const started = time(value.started);
  const turn = count(value.turn);
  if (typeof value.request !== "string" || started === null || turn === null) return null;
  if (typeof value.unit !== "string" || typeof value.log !== "string") return null;
  const messages = Array.isArray(value.messages)
    ? value.messages.flatMap((each): RunMessage[] => {
        const at = isRaw(each) ? time(each.at) : null;
        return isRaw(each) && typeof each.text === "string" && at !== null ? [{ text: each.text, at }] : [];
      })
    : [];
  return {
    v: RECORD_VERSION,
    id: value.id,
    request: value.request,
    harness: value.harness,
    started,
    turn,
    unit: value.unit,
    log: value.log,
    messages,
    window: count(value.window),
    sites: Array.isArray(value.sites) ? value.sites.filter((site): site is string => typeof site === "string") : [],
    undos: Array.isArray(value.undos) ? value.undos.flatMap((each) => undoOf(each) ?? []) : [],
    stopped: count(value.stopped),
    told: count(value.told),
  };
}

/** A task's unit name: its run and turn. */
const UNIT = /^dashi-task-([a-z0-9]{4,24})-(\d{1,4})\.service$/;

export function unitParts(unit: string): { run: string; turn: number } | null {
  const found = UNIT.exec(unit);
  return found?.[1] && found[2] ? { run: found[1], turn: Number(found[2]) } : null;
}

/**
 * The tasks' units still running, from `systemctl --user list-units --plain
 * --no-legend --all 'dashi-task-*'` (unit, load, active, sub, description):
 * each run's turn whose unit is active or starting.
 */
export function runningUnits(listed: string): Map<string, number> {
  const running = new Map<string, number>();
  for (const line of listed.split("\n")) {
    const [unit = "", , active = ""] = line.trim().split(/\s+/);
    const parts = unitParts(unit);
    if (!parts || (active !== "active" && active !== "activating" && active !== "reloading")) continue;
    if ((running.get(parts.run) ?? 0) < parts.turn) running.set(parts.run, parts.turn);
  }
  return running;
}

/** Which harness wrote a stream: the one whose parser reads the most events from it; null when none reads any. */
export function harnessOfStream(stream: string): HarnessId | null {
  let best: { id: HarnessId; events: number } | null = null;
  for (const id of HARNESS_IDS) {
    const events = streamEvents(id, stream).length;
    if (events > 0 && (!best || events > best.events)) best = { id, events };
  }
  return best?.id ?? null;
}

/** The person's words in a turn's prompt: the first paragraph of the first turn (the request; the context comes after). */
export const requestOfPrompt = (prompt: string): string => prompt.split(/\n\s*\n/)[0]?.trim() ?? "";
