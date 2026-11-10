/**
 * What is kept of the runs: each run's record on disk (records.ts) as it changes,
 * the notification for a run that ended (once), the files of runs over an hour
 * old, and, when a shell starts, the runs it picks up again.
 */

import { ANSWERERS, type HarnessId } from "../../ask/answerer.ts";
import { TASK_GRANTED, TASK_REFUSED } from "../grants.ts";
import type { HandoffDeps } from "../types.ts";
import { replayRun, runsToPickUp } from "./pickup.ts";
import { recordOf } from "./records.ts";
import { streamOf, unitOf } from "./runner.ts";

export class RunKeeper {
  /** Runs with a folder on disk, whose record is kept there; the record last written for each. */
  private readonly onDisk = new Set<string>();
  private readonly written = new Map<string, string>();
  /** The turn the person stopped, and the turn whose end they were told of, for each run's record. */
  private readonly stoppedTurn = new Map<string, number>();
  private readonly toldTurn = new Map<string, number>();
  /** While runs are picked up again: their records are as they were, not as the replay has them so far. */
  private replaying = false;
  private readonly told = new Set<string>();
  private readonly offRuns: () => void;
  private readonly pruner: ReturnType<typeof setInterval>;

  constructor(private readonly deps: HandoffDeps) {
    const { runs, runner, policies, options } = deps;
    // Ended runs: their notification once; runs over an hour old: their files.
    this.offRuns = runs.subscribe(() => {
      for (const run of runs.getSnapshot()) {
        const key = `${run.id}:${run.turn}`;
        if (run.ended === null || this.told.has(key)) continue;
        this.told.add(key);
        this.toldTurn.set(run.id, run.turn);
        options.ended?.(run);
      }
      this.save();
    });
    this.pruner = setInterval(() => {
      for (const run of runs.prune()) {
        runner.forget(run);
        policies.delete(run);
        for (const map of [this.written, this.stoppedTurn, this.toldTurn]) map.delete(run);
        this.onDisk.delete(run);
      }
    }, 60_000);
  }

  /** A run's folder now exists: its record is kept. */
  track(run: string): void {
    this.onDisk.add(run);
  }

  /** The person stopped turn `turn` of `run`. */
  stopped(run: string, turn: number): void {
    this.stoppedTurn.set(run, turn);
  }

  save(): void {
    const { runs, runner, runtime, policies } = this.deps;
    if (this.replaying) return;
    for (const run of runs.getSnapshot()) {
      if (!this.onDisk.has(run.id)) continue;
      const policy = policies.get(run.id);
      const record = recordOf(run, {
        unit: unitOf(run.id, run.turn),
        log: streamOf(runtime, run.id, run.turn),
        window: policy?.window ?? null,
        sites: policy?.sites ?? [],
        stopped: this.stoppedTurn.get(run.id) ?? null,
        told: this.toldTurn.get(run.id) ?? null,
      });
      const json = JSON.stringify(record);
      if (this.written.get(run.id) === json) continue;
      this.written.set(run.id, json);
      runner.save(record);
    }
  }

  /**
   * What a shell that starts picks up again (pickup.ts): each run whose unit
   * still runs and each ended in the last hour, its policy and what the
   * person was told of it as they were. `watch` reads a turn on as it grows.
   */
  pickUp(watch: (run: string, harness: HarnessId, turn: number) => void): void {
    const { runs, runner, runtime, policies, options } = this.deps;
    if (!runtime) return;
    const { pickUp: found, forget } = runsToPickUp(runner.found(), runner, runtime, options.now?.() ?? Date.now());
    for (const run of forget) runner.forget(run);
    for (const each of found) {
      const { id, harness, turn } = each.record;
      if (runs.get(id)) continue;
      const name = ANSWERERS[harness].name;
      policies.set(id, { granted: TASK_GRANTED, refused: TASK_REFUSED, window: each.record.window, name, sites: new Set(each.record.sites) });
      this.onDisk.add(id);
      this.written.set(id, JSON.stringify(each.record));
      if (each.record.stopped !== null) this.stoppedTurn.set(id, each.record.stopped);
      if (each.record.told !== null) this.toldTurn.set(id, each.record.told);
      // The person heard of the turns before this one (a follow-up came after them), and of this one if the record says so.
      for (let before = 1; before < turn; before++) this.told.add(`${id}:${before}`);
      if (each.record.told === turn) this.told.add(`${id}:${turn}`);
      this.replaying = true;
      try {
        replayRun(each, name, runs, runner, watch);
      } catch (error) {
        console.error(`dashi-shell: couldn't pick up run ${id} again:`, error);
      } finally {
        this.replaying = false;
      }
    }
  }

  close(): void {
    this.save();
    this.offRuns();
    clearInterval(this.pruner);
  }
}
