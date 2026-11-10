/**
 * What a shell that starts picks up again (docs/actions.md, "Agents from
 * the launcher"): each run whose unit still runs and each ended in the last
 * hour, from its record and its streams (records.ts, runner.ts `found`);
 * the files of one ended longer ago go. A run's card is rebuilt by reading
 * its turns again into the store, each as it went (ended then, not now);
 * the turn still running is read on as it grows. service.ts does the rest:
 * the run's policy and what it was told.
 */

import type { HarnessId } from "../../ask/index.ts";
import { RETAIN_MS } from "../run-view.ts";
import type { AgentRuns } from "../store.ts";
import { harnessOfStream, type RunRecord, requestOfPrompt } from "./records.ts";
import { type FoundRun, type FoundRuns, streamOf, type TaskRunner, unitOf } from "./runner.ts";
import { eventsOf } from "./stream.ts";

/** A run to pick up: its record, and whether its turn still runs. */
export interface PickUp {
  record: RunRecord;
  running: boolean;
}

/** A run's record from its folder when it has none (an older shell started it): only while its unit runs, by what its stream says. */
function recordless(found: FoundRun, running: number, runner: Pick<TaskRunner, "readTurn">, runtime: string, now: number): RunRecord | null {
  const first = runner.readTurn(found.id, 1);
  const harness = first ? harnessOfStream(first.lines.join("\n")) : null;
  if (!harness) return null;
  const turn = Math.max(found.turn, running);
  return {
    v: 1,
    id: found.id,
    request: requestOfPrompt(found.prompt) || "A task",
    harness,
    started: found.promptAt || now,
    turn,
    unit: unitOf(found.id, turn),
    log: streamOf(runtime, found.id, turn),
    messages: [],
    window: null,
    sites: [],
    undos: [],
    stopped: null,
    told: null,
  };
}

/** The runs to pick up, and those whose files go (ended over an hour ago). */
export function runsToPickUp(found: FoundRuns, runner: Pick<TaskRunner, "readTurn">, runtime: string, now: number): { pickUp: PickUp[]; forget: string[] } {
  const pickUp: PickUp[] = [];
  const forget: string[] = [];
  for (const each of found.runs) {
    const active = found.running.get(each.id);
    const record = each.record ?? (active === undefined ? null : recordless(each, active, runner, runtime, now));
    if (!record) continue;
    if (active !== undefined && active >= record.turn) {
      pickUp.push({ record: { ...record, turn: active }, running: true });
      continue;
    }
    const ended = runner.readTurn(record.id, record.turn)?.changed ?? record.started;
    if (now - ended > RETAIN_MS) forget.push(record.id);
    else pickUp.push({ record, running: false });
  }
  return { pickUp, forget };
}

/** Rebuild a run in the store from its record and its turns' streams; `watch` reads on the turn still running. */
export function replayRun(
  { record, running }: PickUp,
  harnessName: string,
  runs: AgentRuns,
  runner: Pick<TaskRunner, "readTurn">,
  watch: (run: string, harness: HarnessId, turn: number) => void,
): void {
  const { id, harness, turn } = record;
  runs.start({ id, request: record.request, harness, harnessName, started: record.started });
  record.undos.forEach((entry, index) => {
    runs.changed(id, entry.undo);
    if (entry.undone) runs.undone(id, index);
  });
  for (let each = 1; each <= turn; each++) {
    if (each > 1) {
      const message = record.messages[each - 2];
      runs.at(message?.at ?? record.started, () => runs.followUp(id, message?.text ?? ""));
    }
    const stopped = record.stopped === each;
    if (each === turn && running) {
      if (stopped) runs.stopping(id, true);
      watch(id, harness, each);
      continue;
    }
    const read = runner.readTurn(id, each);
    runs.at(read?.changed ?? record.started, () => {
      for (const line of read?.lines ?? []) for (const event of eventsOf(harness, line)) runs.event(id, event);
      if (stopped) runs.stopping(id, true);
      runs.exited(id, read?.exit?.code ?? null);
    });
  }
}
