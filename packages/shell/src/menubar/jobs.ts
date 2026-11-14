/**
 * The jobs every menu bar shows (lib/bar-jobs.ts), as one store: the
 * launcher's Ask tasks, the runs and the connected agents, with who speaks
 * now. The Ask tasks start after the bars do, so they are asked for each
 * time until they are there. A finished job falls silent by itself after a
 * while; one looked at (its panel opened) leaves the bar.
 */

import { type AgentInfo, mergeAgents, type RunView, type TaskView } from "../agents/index.ts";
import type { PillAsk } from "../shared/pill/index.ts";
import { realTimers, type Timers } from "../shared/time/index.ts";
import { agentJobs, type BarJob, type JobStamps, nextSilence, speaker, stampJobs, taskJobs } from "./lib/bar-jobs.ts";

interface Source<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export interface BarJobsSources {
  /** The launcher's Ask tasks, or null until they have started. */
  tasks(): Source<readonly TaskView[]> | null;
  agents: Source<readonly AgentInfo[]>;
  runs: Source<readonly RunView[]>;
  asks: Source<readonly PillAsk[]>;
  now?(): number;
  timers?: Timers;
}

export interface JobsSnapshot {
  /** The oldest first. */
  jobs: readonly BarJob[];
  /** The key of the job that speaks; null for none. */
  speaking: string | null;
}

const EMPTY: JobsSnapshot = { jobs: [], speaking: null };
/** How often the Ask tasks are looked for until they have started. */
const LOOK_MS = 500;

export class BarJobs {
  private snapshot: JobsSnapshot = EMPTY;
  private stamps: JobStamps = new Map();
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly stops: (() => void)[] = [];
  private tasks: Source<readonly TaskView[]> | null = null;
  private timer: unknown = null;
  private looking: unknown = null;
  private closed = false;

  constructor(private readonly sources: BarJobsSources) {
    const refresh = () => this.refresh();
    this.stops.push(sources.agents.subscribe(refresh), sources.runs.subscribe(refresh), sources.asks.subscribe(refresh));
    this.look();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): JobsSnapshot => this.snapshot;

  /** The person looked at this job (its panel opened): a finished one leaves the bar. */
  looked(job: BarJob): void {
    if (job.kind !== "task" || job.state !== "fin") return;
    this.seen.add(job.id);
    this.refresh();
  }

  /** The panel opened on all of them ("+N", the keyboard): every finished one was looked at. */
  lookedAll(): void {
    const finished = this.snapshot.jobs.filter((job) => job.kind === "task" && job.state === "fin");
    for (const job of finished) this.seen.add(job.id);
    if (finished.length > 0) this.refresh();
  }

  close(): void {
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    const timers = this.timers();
    if (this.timer !== null) timers.clear(this.timer);
    if (this.looking !== null) timers.clear(this.looking);
  }

  private timers(): Timers {
    return this.sources.timers ?? realTimers;
  }

  /** The Ask tasks, once they have started. */
  private look(): void {
    this.looking = null;
    if (this.closed || this.tasks) return;
    this.tasks = this.sources.tasks();
    if (!this.tasks) {
      this.looking = this.timers().set(() => this.look(), LOOK_MS);
      return;
    }
    this.stops.push(this.tasks.subscribe(() => this.refresh()));
    this.refresh();
  }

  private refresh(): void {
    if (this.closed) return;
    const now = (this.sources.now ?? Date.now)();
    const { agents, runs, asks } = this.sources;
    const jobs = [
      ...agentJobs(mergeAgents(agents.getSnapshot(), runs.getSnapshot())),
      ...taskJobs(this.tasks?.getSnapshot() ?? [], asks.getSnapshot(), this.seen),
    ];
    this.stamps = stampJobs(this.stamps, jobs, now);
    const speaking = speaker(jobs, this.stamps, now);
    const timers = this.timers();
    if (this.timer !== null) timers.clear(this.timer);
    const next = nextSilence(jobs, this.stamps, now);
    this.timer = next === null ? null : timers.set(() => this.refresh(), next - now + 1);
    const before = this.snapshot;
    const same =
      before.speaking === speaking &&
      before.jobs.length === jobs.length &&
      before.jobs.every((job, index) => {
        const other = jobs[index];
        return (
          other !== undefined &&
          job.key === other.key &&
          job.state === other.state &&
          job.step === other.step &&
          job.title === other.title &&
          job.ask === other.ask
        );
      });
    if (same) return;
    this.snapshot = { jobs, speaking };
    for (const listener of [...this.listeners]) listener();
  }
}
