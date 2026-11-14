/**
 * A stand-in for what drives the capsule, for proof in the VM and for tests
 * (docs/night-0.9-contract.md: "until core's branch is merged, drive it from
 * a fake"): dictation's states set straight on the hub, as core will, and a
 * voice controller and Ask tasks that say what 0.8's would, which the real
 * adapter (voice-mode.ts) reads. `DASHI_CAPSULE_FAKE=<file>` in the shell's
 * environment turns it on: each line added to the file is a scene's name
 * (scenes.ts).
 */

import { cell, type PillHub } from "../../shared/pill/index.ts";
import type { Timers } from "../../shared/time/index.ts";
import type { Chip } from "../../voice/index.ts";
import type { CardQuestion } from "../types.ts";
import type { Task, TaskSource, VoiceSource } from "./sources.ts";

export class FakeVoice implements VoiceSource {
  private readonly chip = cell<Chip | null>(null);
  readonly level = cell(0);
  private heard: ((text: string) => void) | null = null;
  /** What it was last asked to say. */
  said = "";

  subscribe = (listener: () => void): (() => void) => this.chip.subscribe(listener);
  getSnapshot = (): Chip | null => this.chip.getSnapshot();

  show(chip: Chip | null): void {
    this.chip.set(chip);
  }

  stop(): void {
    this.chip.set(null);
  }

  ask(words: string, heard: (text: string) => void): () => void {
    this.said = words;
    this.heard = heard;
    return () => {
      if (this.heard === heard) this.heard = null;
    };
  }

  /** The person said `text` while a question waited; false when none did. */
  hear(text: string): boolean {
    const heard = this.heard;
    this.heard = null;
    heard?.(text);
    return heard !== null;
  }

  talkKey(): string | null {
    return "the Dashi key";
  }
}

export class FakeTasks implements TaskSource {
  private readonly tasks = cell<readonly Task[]>([]);
  private next = 0;

  constructor(
    private readonly timers: Timers,
    /** Whether the person's own press or word said yes (the real tasks ask the compositor). */
    private readonly pressed: () => Promise<boolean>,
    private readonly stepMs = 1400,
  ) {}

  subscribe = (listener: () => void): (() => void) => this.tasks.subscribe(listener);
  getSnapshot = (): readonly Task[] => this.tasks.getSnapshot();

  private change(id: string, change: (task: Task) => Task): void {
    this.tasks.set(this.tasks.getSnapshot().map((task) => (task.id === id ? change(task) : task)));
  }

  /** A new task: asking, then (`settle`) planned with `steps`, or done with `said`. */
  ask(request: string): string {
    const id = `fake-${++this.next}`;
    this.tasks.set([{ id, request, phase: "asking", said: "", steps: [] }, ...this.tasks.getSnapshot()]);
    return id;
  }

  settle(id: string, steps: readonly string[], said = ""): void {
    this.change(id, (task) => ({
      ...task,
      phase: steps.length > 0 ? "planned" : "done",
      said,
      steps: steps.map((title) => ({ title, state: { kind: "ready" } })),
    }));
  }

  async run(id: string): Promise<void> {
    const task = this.tasks.getSnapshot().find((each) => each.id === id);
    if (!task || task.phase !== "planned") return;
    if (!(await this.pressed()))
      return this.change(id, (each) => ({ ...each, steps: each.steps.map((step) => ({ ...step, state: { kind: "not-allowed" } })) }));
    this.change(id, (each) => ({ ...each, phase: "running" }));
    task.steps.forEach((_, index) => {
      this.timers.set(() => this.step(id, index, "running"), index * this.stepMs);
      this.timers.set(() => this.step(id, index, "done"), (index + 1) * this.stepMs);
    });
    this.timers.set(() => this.change(id, (each) => (each.phase === "running" ? { ...each, phase: "done" } : each)), task.steps.length * this.stepMs + 1);
  }

  private step(id: string, index: number, kind: string): void {
    this.change(id, (task) =>
      task.phase === "running" ? { ...task, steps: task.steps.map((step, at) => (at === index ? { ...step, state: { kind } } : step)) } : task,
    );
  }

  stop(id: string): void {
    this.change(id, (task) => ({ ...task, phase: "stopped" }));
  }

  clear(): void {
    this.tasks.set([]);
  }
}

/** What a scene may move. */
export interface Stage {
  hub: PillHub;
  voice: FakeVoice;
  tasks: FakeTasks;
  timers: Timers;
  now(): number;
  /** An agent's question, as agent-sheets sends it. */
  question(question: CardQuestion): void;
}

/** A scene: what it does now, and what it does later (`at` ms from now). */
export type Scene = (stage: Stage) => void;

/** Run `steps` on the stage's timers: `[ms from the scene's start, what to do]`. */
export function script(stage: Stage, steps: ReadonlyArray<readonly [number, () => void]>): void {
  for (const [at, step] of steps) {
    if (at === 0) step();
    else stage.timers.set(step, at);
  }
}

/** The microphone's level, moving as a voice does, for `ms`. */
export function wobble(stage: Stage, ms: number): void {
  const levels = [0.15, 0.55, 0.9, 0.4, 0.7, 0.25, 0.8, 0.5, 0.95, 0.3, 0.6, 0.1];
  for (let at = 0; at < ms; at += 90) stage.timers.set(() => stage.hub.level.set(levels[(at / 90) % levels.length] ?? 0), at);
  stage.timers.set(() => stage.hub.level.set(0), ms);
}

/** Read the scenes file's new lines every so often and play each; returns what stops it. */
export function followScenes(path: string, play: (name: string) => void, timers: Timers, everyMs = 200): () => void {
  let read = 0;
  let stopped = false;
  const look = async (): Promise<void> => {
    if (stopped) return;
    const text = await Bun.file(path)
      .text()
      .catch(() => "");
    const lines = text.split("\n").slice(0, -1);
    for (const line of lines.slice(read)) if (line.trim() !== "") play(line.trim());
    read = Math.max(read, lines.length);
    if (!stopped) timers.set(() => void look(), everyMs);
  };
  void look();
  return () => {
    stopped = true;
  };
}
