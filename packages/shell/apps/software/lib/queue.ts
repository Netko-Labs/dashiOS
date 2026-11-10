/**
 * Changes run one at a time, in the order the person asked (flatpak and
 * PackageKit hold locks, and two progress bars racing help nobody): apps,
 * applets and the system share this one queue, so the toolbar's activity
 * chip can say what is happening and what waits. A
 * queued change can be taken back; a running one is stopped through its
 * AbortSignal. The queue knows nothing about flatpak: `start` does the work.
 */

import type { Outcome, Progress } from "../../src/shared/software/index.ts";
import type { Operation } from "./model.ts";

export interface Job {
  operation: Omit<Operation, "status" | "progress">;
  /** Does the work; reports progress; finishes with how it went. */
  start(report: (progress: Progress) => void, signal: AbortSignal): Promise<Outcome>;
  /** After it finished, however it went (an applet reads its folder again). */
  done?(outcome: Outcome): void;
}

export interface QueueEvents {
  /** The operations changed (a start, a progress step, a finish). */
  changed(operations: readonly Operation[]): void;
  /** A change finished. */
  finished(job: Job["operation"], outcome: Outcome): void;
}

export class OperationQueue {
  private readonly waiting: Job[] = [];
  private current: { job: Job; operation: Operation; abort: AbortController } | null = null;

  constructor(private readonly events: QueueEvents) {}

  get operations(): readonly Operation[] {
    return [
      ...(this.current ? [{ ...this.current.operation }] : []),
      ...this.waiting.map((job) => ({ ...job.operation, status: "queued" as const, progress: null })),
    ];
  }

  has(key: string): boolean {
    return this.current?.operation.key === key || this.waiting.some((job) => job.operation.key === key);
  }

  /** Adds a change unless that very change is already waiting or running. */
  enqueue(job: Job): boolean {
    if (this.has(job.operation.key)) return false;
    this.waiting.push(job);
    this.events.changed(this.operations);
    void this.pump();
    return true;
  }

  /** Takes a queued change back, or stops the running one. */
  cancel(key: string): void {
    const index = this.waiting.findIndex((job) => job.operation.key === key);
    if (index >= 0) {
      this.waiting.splice(index, 1);
      this.events.changed(this.operations);
    } else if (this.current?.operation.key === key) {
      this.current.abort.abort();
    }
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const job = this.waiting.shift();
    if (!job) return;
    const abort = new AbortController();
    const operation: Operation = { ...job.operation, status: "running", progress: null };
    this.current = { job, operation, abort };
    this.events.changed(this.operations);
    let outcome: Outcome;
    try {
      outcome = await job.start((progress) => {
        if (this.current?.job !== job) return;
        operation.progress = progress;
        this.events.changed(this.operations);
      }, abort.signal);
    } catch (error) {
      outcome = { ok: false, message: error instanceof Error ? error.message : "It did not finish." };
    }
    this.current = null;
    try {
      job.done?.(outcome);
    } catch (error) {
      console.error("dashi-software: after a change:", error instanceof Error ? error.message : error);
    }
    this.events.finished(job.operation, outcome);
    this.events.changed(this.operations);
    void this.pump();
  }
}
