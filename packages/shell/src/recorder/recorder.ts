/**
 * The screen recorder: one recording at a time, made by wf-recorder
 * (command.ts) and followed here for the menu bar's stop button
 * (indicator.tsx) and the ⇧❖5 toolbar (toolbar.tsx). wf-recorder may copy
 * the screen only while it records: `allow` adds it to the compositor's
 * screencopy list for that long. Stopping sends SIGINT, which makes
 * wf-recorder finish the file.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { useSyncExternalStore } from "react";
import { CODECS, type RecordTarget, recorderArgs, recordingDirectory, recordingName, WF_RECORDER } from "./command.ts";

/** Who started a recording: the person (⇧❖5's toolbar), or an agent (record_screen). */
export type RecordedBy = "person" | "agent";

export type RecorderState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; since: number; file: string; target: RecordTarget; by: RecordedBy }
  | { kind: "saving"; file: string };

/** A running wf-recorder, as far as the recorder needs it. */
export interface RecorderProcess {
  exited: Promise<number>;
  kill(signal: "SIGINT" | "SIGKILL"): void;
  /** A gated process (spawn's `gated`): its pid, which wf-recorder keeps when it starts. */
  pid?: number;
  /** A gated process: start wf-recorder now. */
  go?(): void;
}

export interface RecorderDeps {
  /** Let `path` use screencopy until the returned function runs (screen-capture.ts). */
  allow(path: string): () => void;
  /** `gated`: wait, before wf-recorder starts, for `go()` (the pid is known first). */
  spawn?(argv: string[], gated?: boolean): RecorderProcess;
  exists?(path: string): boolean;
  directory?(): string;
  now?(): number;
  /** A recording was saved. */
  saved?(file: string): void;
  /** A recording could not start or ended on its own. */
  failed?(message: string): void;
}

/** A recorder still running after this long has started; one that exits sooner failed to (a codec it lacks, no screen). */
export const STARTUP_MS = 700;
/** The compositor calls a capture over 2 s after its last frame; the recorder's stays its own that long. */
const CAPTURE_TAIL_MS = 3000;
/** How long wf-recorder gets to finish the file after SIGINT. */
const FINISH_MS = 10_000;

const sleep = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

function spawnRecorder(argv: string[], gated = false): RecorderProcess {
  if (!gated) {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return { exited: child.exited, kill: (signal) => child.kill(signal) };
  }
  // A shell that waits for a line, then becomes wf-recorder (exec keeps the
  // pid): the compositor is told the pid before the first frame is copied.
  const child = Bun.spawn(["/bin/sh", "-c", 'read -r _ && exec "$0" "$@"', ...argv], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  return {
    exited: child.exited,
    kill: (signal) => child.kill(signal),
    pid: child.pid,
    go: () => {
      child.stdin.write("\n");
      void child.stdin.end();
    },
  };
}

export class ScreenRecorder {
  private state: RecorderState = { kind: "idle" };
  private readonly listeners = new Set<() => void>();
  private process: RecorderProcess | null = null;
  private revoke: (() => void) | null = null;
  private stopping = false;
  private endedAt = Number.NEGATIVE_INFINITY;
  /** When the running wf-recorder began capturing (it starts before it is known to have started). */
  private began = 0;
  /** The last recording that ended: its file and how long it is, by the recorder's own clock. */
  private last: { file: string; seconds: number } | null = null;

  constructor(private readonly deps: RecorderDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecorderState => this.state;

  private set(state: RecorderState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  /** Whether a screen capture going on now is the recorder's: it records, or stopped a moment ago. */
  ownsCapture(now: number = Date.now()): boolean {
    return this.state.kind !== "idle" || now - this.endedAt < CAPTURE_TAIL_MS;
  }

  /** Whether wf-recorder is installed. */
  available(): boolean {
    return (this.deps.exists ?? existsSync)(WF_RECORDER);
  }

  /** Start recording `target`; resolves with the file it is writing, rejects with why it couldn't. */
  async start(target: RecordTarget, options: { microphone?: boolean; beforeCapture?: (pid: number) => Promise<void>; by?: RecordedBy } = {}): Promise<string> {
    const now = this.deps.now ?? Date.now;
    if (this.state.kind !== "idle") throw new Error("A recording is already running.");
    if (!this.available()) throw new Error("Screen recording needs wf-recorder (dnf install wf-recorder).");
    this.set({ kind: "starting" });
    const directory = (this.deps.directory ?? recordingDirectory)();
    mkdirSync(directory, { recursive: true });
    const exists = this.deps.exists ?? existsSync;
    this.revoke = this.deps.allow(WF_RECORDER);
    // The list reaches the compositor before wf-recorder binds the global.
    await sleep(50);
    for (const codec of CODECS) {
      const file = join(
        directory,
        recordingName(new Date((this.deps.now ?? Date.now)()), codec.extension, (name) => exists(join(directory, name))),
      );
      const argv = [WF_RECORDER, ...recorderArgs({ target, file, codec, microphone: options.microphone ?? false })];
      const process = (this.deps.spawn ?? spawnRecorder)(argv, options.beforeCapture !== undefined);
      let began = now();
      if (options.beforeCapture) {
        // An agent's recording: its blanks reach the compositor before wf-recorder copies a frame.
        try {
          if (process.pid === undefined || !process.go) throw new Error("no pid");
          await options.beforeCapture(process.pid);
        } catch {
          process.kill("SIGKILL");
          this.release();
          this.set({ kind: "idle" });
          throw new Error("The recording was not started: Dashi couldn't blank what agents must not see.");
        }
        process.go();
        began = now();
      }
      const early = await Promise.race([process.exited, sleep(STARTUP_MS)]);
      if (early !== "timeout") {
        rmSync(file, { force: true });
        continue;
      }
      this.process = process;
      this.began = began;
      this.set({ kind: "recording", since: now(), file, target, by: options.by ?? "person" });
      void process.exited.then(() => this.ended(file));
      return file;
    }
    this.release();
    this.set({ kind: "idle" });
    throw new Error("The screen recorder could not start: no video encoder worked, or the screen could not be captured.");
  }

  /** Stop and save; resolves with the file, or null when nothing was recording. */
  async stop(): Promise<string | null> {
    if (this.state.kind !== "recording" || !this.process) return null;
    const { file } = this.state;
    const process = this.process;
    this.stopping = true;
    this.set({ kind: "saving", file });
    process.kill("SIGINT");
    if ((await Promise.race([process.exited, sleep(FINISH_MS)])) === "timeout") process.kill("SIGKILL");
    await process.exited;
    return file;
  }

  /** wf-recorder exited: asked to (stop), or on its own (the screen went away, the disk filled). */
  private ended(file: string): void {
    const asked = this.stopping;
    this.stopping = false;
    this.process = null;
    this.release();
    this.endedAt = (this.deps.now ?? Date.now)();
    this.last = { file, seconds: Math.max(0, this.endedAt - this.began) / 1000 };
    this.set({ kind: "idle" });
    if (!asked) this.deps.failed?.("The screen recording stopped on its own.");
    if ((this.deps.exists ?? existsSync)(file)) this.deps.saved?.(file);
  }

  /** How long the recording saved to `file` is, in seconds, if it was the last one to end. */
  lengthOf(file: string): number | null {
    return this.last?.file === file ? this.last.seconds : null;
  }

  private release(): void {
    this.revoke?.();
    this.revoke = null;
  }

  /** Stop at shell exit, keeping what was recorded. */
  close(): void {
    void this.stop();
  }
}

export function useRecorder(recorder: ScreenRecorder): RecorderState {
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
}
