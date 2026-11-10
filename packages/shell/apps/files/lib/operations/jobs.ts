/**
 * Long operations as the window shows them: a job has a label, progress, and
 * an AbortController behind its Cancel button. The footer subscribes to the
 * list. Updates reach subscribers at most every 60 ms, so a copy of a
 * thousand small files doesn't redraw the window a thousand times.
 */

import { Cancelled, type OpContext } from "../../../../src/shared/files/index.ts";

export type JobState = "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: number;
  label: string;
  state: JobState;
  /** Work done and the work there is (bytes, or items); `total` is null while unknown. */
  done: number;
  total: number | null;
  /** What went wrong, or a note on how it ended. */
  message: string | null;
}

interface Entry {
  job: Job;
  controller: AbortController;
}

export class Jobs {
  private entries: Entry[] = [];
  private nextId = 1;
  private snapshot: readonly Job[] = [];
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Job[] => this.snapshot;

  /** Starts `work`; the job ends `done`, `failed` (with the error's words), or `cancelled`. Resolves with the job when it ends. */
  // biome-ignore lint/suspicious/noConfusingVoidType: most work returns nothing; some returns the path it made.
  run(label: string, total: number | null, work: (ctx: OpContext, job: Job) => Promise<string | void>): Promise<Job> {
    const controller = new AbortController();
    const job: Job = { id: this.nextId++, label, state: "running", done: 0, total, message: null };
    this.entries.push({ job, controller });
    this.publish(true);
    const ctx: OpContext = {
      signal: controller.signal,
      advance: (bytes) => {
        job.done += bytes;
        this.publish(false);
      },
    };
    return work(ctx, job).then(
      (note) => {
        job.state = "done";
        job.message = note ?? null;
        return this.finish(job);
      },
      (error) => {
        if (error instanceof Cancelled || controller.signal.aborted) {
          job.state = "cancelled";
          job.message = "Cancelled.";
        } else {
          job.state = "failed";
          job.message = error instanceof Error ? error.message : String(error);
        }
        return this.finish(job);
      },
    );
  }

  cancel(id: number): void {
    this.entries.find((entry) => entry.job.id === id && entry.job.state === "running")?.controller.abort();
  }

  /** Whether anything is still running. */
  get busy(): boolean {
    return this.entries.some((entry) => entry.job.state === "running");
  }

  /** Forgets finished jobs (the footer shows their outcome once). */
  clearFinished(): void {
    this.entries = this.entries.filter((entry) => entry.job.state === "running");
    this.publish(true);
  }

  private finish(job: Job): Job {
    this.publish(true);
    return job;
  }

  private publish(now: boolean): void {
    if (now) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.emit();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.emit();
      }, 60);
    }
  }

  private emit(): void {
    this.snapshot = this.entries.map((entry) => ({ ...entry.job }));
    for (const listener of this.listeners) listener();
  }
}
