/**
 * The Extras page and the Installing page share this: the choices, then one
 * run of them. A run is the helper's steps (as root, through pkexec), then
 * the ticked Flathub apps, one at a time through Software's manager (for the
 * person, no password). It goes on when the window moves to another page, or
 * closes: dnf is never stopped halfway.
 */

import type { Outcome, Progress, Software } from "../../shared/software/manager.ts";
import type { RecommendedApp } from "../../shared/software/recommended.ts";
import { applyEvent, type ExtraStep, endOfRun, failedSteps, isOffline, type StepStates, waitingStates } from "./events.ts";
import type { RunHelper } from "./helper.ts";
import { appsFor, defaultChoices, type ExtrasChoices, type ExtrasHardware, hasWork, stepsFor, toggleApp } from "./plan.ts";

export type AppStatus =
  | { status: "waiting" }
  | { status: "installing"; progress: Progress | null }
  | { status: "done"; message: string | null }
  | { status: "failed"; message: string }
  /** Not tried: offline, or the password was not given. */
  | { status: "skipped" };

export interface AppRow {
  app: RecommendedApp;
  state: AppStatus;
}

export type RunPhase = "idle" | "running" | "cancelled" | "denied" | "finished";

export interface ExtrasRun {
  phase: RunPhase;
  steps: ExtraStep[];
  states: StepStates;
  apps: AppRow[];
}

export interface ExtrasSnapshot {
  /** Null until it has been looked at. */
  hardware: ExtrasHardware | null;
  choices: ExtrasChoices;
  run: ExtrasRun;
}

export type AppInstaller = Pick<Software, "hasFlatpak" | "installed" | "install">;

export interface ExtrasDeps {
  detect: () => Promise<ExtrasHardware>;
  runHelper: RunHelper;
  software: AppInstaller;
}

const NO_HARDWARE: ExtrasHardware = { nvidia: false, nvidiaInstalled: false, gamingInstalled: false };
const IDLE: ExtrasRun = { phase: "idle", steps: [], states: {}, apps: [] };

/** Whether the run as a whole went fine: every step done, every app done. */
export function isRunOk(run: ExtrasRun): boolean {
  return run.phase === "finished" && run.steps.every((step) => run.states[step]?.status === "done") && run.apps.every((row) => row.state.status === "done");
}

/** Whether a run has something to try again: a failed step or app, or a run that never got its password. */
export function canRetry(run: ExtrasRun): boolean {
  if (run.phase === "cancelled" || run.phase === "denied") return true;
  return run.phase === "finished" && (failedSteps(run.steps, run.states).length > 0 || run.apps.some((row) => row.state.status !== "done"));
}

export class ExtrasStore {
  private snapshot: ExtrasSnapshot;
  private readonly listeners = new Set<() => void>();
  private detecting: Promise<void> | null = null;

  constructor(private readonly deps: ExtrasDeps) {
    this.snapshot = { hardware: null, choices: defaultChoices(NO_HARDWARE), run: IDLE };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ExtrasSnapshot => this.snapshot;

  private set(patch: Partial<ExtrasSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  private setRun(patch: Partial<ExtrasRun>): void {
    this.set({ run: { ...this.snapshot.run, ...patch } });
  }

  /** Looks at the computer once; the switches then start where they should. */
  detect(): Promise<void> {
    this.detecting ??= this.deps
      .detect()
      .catch(() => NO_HARDWARE)
      .then((hardware) => this.set({ hardware, choices: { ...defaultChoices(hardware), apps: this.snapshot.choices.apps } }));
    return this.detecting;
  }

  choose(patch: Partial<Omit<ExtrasChoices, "apps">>): void {
    this.set({ choices: { ...this.snapshot.choices, ...patch } });
  }

  toggleApp(id: string): void {
    this.set({ choices: toggleApp(this.snapshot.choices, id) });
  }

  /** Whether Continue on the Extras page installs something. */
  hasWork(): boolean {
    return hasWork(this.snapshot.choices, this.snapshot.hardware ?? NO_HARDWARE);
  }

  get running(): boolean {
    return this.snapshot.run.phase === "running";
  }

  /** Starts a run of the current choices (nothing while one runs). */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    const { choices } = this.snapshot;
    const steps = stepsFor(choices, this.snapshot.hardware ?? NO_HARDWARE);
    const apps = appsFor(choices).map((app): AppRow => ({ app, state: { status: "waiting" } }));
    return this.go(steps, waitingStates(steps), apps);
  }

  /** Runs again what did not work: the failed steps, and the apps not installed. */
  retry(): Promise<void> {
    const { run } = this.snapshot;
    if (!canRetry(run)) return Promise.resolve();
    const again = run.phase === "finished" ? failedSteps(run.steps, run.states) : run.steps;
    const states: StepStates = { ...run.states, ...waitingStates(again) };
    const apps = run.apps.map((row): AppRow => (row.state.status === "done" ? row : { app: row.app, state: { status: "waiting" } }));
    return this.go(run.steps, states, apps, again);
  }

  private async go(steps: ExtraStep[], states: StepStates, apps: AppRow[], toRun: ExtraStep[] = steps): Promise<void> {
    this.set({ run: { phase: "running", steps, states, apps } });
    if (toRun.length > 0) {
      let live = this.snapshot.run.states;
      const result = await this.deps.runHelper(toRun, (event) => {
        live = applyEvent(live, event);
        this.setRun({ states: live });
      });
      const end = endOfRun(live, result.code, result.sawEvents);
      if (end.kind !== "ran") {
        // Nothing ran: the steps wait for another try, and the apps with them.
        this.setRun({ phase: end.kind, states, apps: this.snapshot.run.apps.map((row) => skip(row)) });
        return;
      }
      this.setRun({ states: end.states });
      if (isOffline(end.states)) {
        this.setRun({ phase: "finished", apps: this.snapshot.run.apps.map((row) => skip(row)) });
        return;
      }
    }
    await this.installApps();
    this.setRun({ phase: "finished" });
  }

  private setApp(id: string, state: AppStatus): void {
    this.setRun({ apps: this.snapshot.run.apps.map((row) => (row.app.id === id ? { app: row.app, state } : row)) });
  }

  private async installApps(): Promise<void> {
    const pending = this.snapshot.run.apps.filter((row) => row.state.status === "waiting");
    if (pending.length === 0) return;
    const { software } = this.deps;
    if (!software.hasFlatpak) {
      for (const row of pending) this.setApp(row.app.id, { status: "failed", message: "Flatpak is not installed." });
      return;
    }
    const have = new Set(
      await software.installed().then(
        (list) => list.map((app) => app.id),
        () => [] as string[],
      ),
    );
    for (const row of pending) {
      if (have.has(row.app.id)) {
        this.setApp(row.app.id, { status: "done", message: "Already installed" });
        continue;
      }
      this.setApp(row.app.id, { status: "installing", progress: null });
      let outcome: Outcome;
      try {
        outcome = await software.install(row.app.id, (progress) => this.setApp(row.app.id, { status: "installing", progress }));
      } catch (error) {
        outcome = { ok: false, message: error instanceof Error ? error.message : "It did not finish." };
      }
      this.setApp(row.app.id, outcome.ok ? { status: "done", message: null } : { status: "failed", message: outcome.message || "It did not finish." });
    }
  }
}

const skip = (row: AppRow): AppRow => (row.state.status === "done" ? row : { app: row.app, state: { status: "skipped" } });
