/**
 * Software's state, outside the views: what is installed, which updates wait
 * (apps and the system), the queue of changes, and the last error. Views read
 * it with `useSyncExternalStore`. Nothing here installs or updates by itself:
 * every change starts from a person's click, and checking for updates only
 * looks.
 */

import {
  type FlatpakUpdate,
  type Installation,
  type InstalledApp,
  MissingTool,
  type Outcome,
  plainFailure,
  type Software,
  type SystemUpdates,
} from "../../src/shared/software/index.ts";
import type { Operation } from "./model.ts";
import { type Job, OperationQueue } from "./queue.ts";

export interface Failure {
  title: string;
  /** What happened and what to do, in Dashi's words (failure-words.ts). */
  message: string;
  /** The tool's own words, behind "Details"; null when there are none. */
  details: string | null;
}

export interface SoftwareState {
  hasFlatpak: boolean;
  hasPackageKit: boolean;
  /** null until the first look. */
  installed: InstalledApp[] | null;
  installedError: string | null;
  appUpdates: FlatpakUpdate[] | null;
  appUpdatesError: string | null;
  system: SystemUpdates | null;
  systemError: string | null;
  /** A check for updates is running. */
  checking: boolean;
  /** When updates were last looked for (ms), or null. */
  checkedAt: number | null;
  /** The system needs a restart to finish earlier updates (null: not known). */
  restartNeeded: boolean | null;
  operations: readonly Operation[];
  failure: Failure | null;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : "Something went wrong.");

/** The failure sheet's words for a change that failed with the tool's `text`: “VLC” wasn’t installed, and why, plainly. */
export function failureOf(operation: Pick<Operation, "kind" | "name" | "id">, text: string): Failure {
  const verb = { install: "installed", remove: "removed", update: "updated", "system-update": "updated" }[operation.kind];
  const title =
    operation.kind === "system-update"
      ? "The system wasn’t updated"
      : operation.kind === "update" && operation.id === undefined
        ? "Your apps weren’t updated"
        : `“${operation.name}” wasn’t ${verb}`;
  return { title, ...plainFailure(text) };
}

export class SoftwareStore {
  private state: SoftwareState;
  private readonly listeners = new Set<() => void>();
  private readonly queue: OperationQueue;

  constructor(
    private readonly software: Pick<
      Software,
      | "hasFlatpak"
      | "hasPackageKit"
      | "installed"
      | "flatpakUpdates"
      | "systemUpdates"
      | "needsRestart"
      | "install"
      | "remove"
      | "updateFlatpak"
      | "updateSystem"
      | "open"
    >,
    private readonly now: () => number = Date.now,
  ) {
    this.state = {
      hasFlatpak: software.hasFlatpak,
      hasPackageKit: software.hasPackageKit,
      installed: null,
      installedError: null,
      appUpdates: null,
      appUpdatesError: null,
      system: null,
      systemError: null,
      checking: false,
      checkedAt: null,
      restartNeeded: null,
      operations: [],
      failure: null,
    };
    this.queue = new OperationQueue({
      changed: (operations) => this.set({ operations }),
      finished: (operation, outcome) => void this.finished(operation, outcome),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SoftwareState => this.state;

  private set(patch: Partial<SoftwareState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads what is installed (local, quick). */
  async refreshInstalled(): Promise<void> {
    if (!this.state.hasFlatpak) return this.set({ installed: [], installedError: null });
    try {
      this.set({ installed: await this.software.installed(), installedError: null });
    } catch (error) {
      this.set({ installed: this.state.installed ?? [], installedError: message(error) });
    }
  }

  /** Looks for updates, apps and system. It installs nothing; `refresh` also asks PackageKit to look at its repositories. */
  async checkUpdates(refresh = false): Promise<void> {
    if (this.state.checking) return;
    this.set({ checking: true });
    const [apps, system, restart] = await Promise.allSettled([
      this.state.hasFlatpak ? this.software.flatpakUpdates() : Promise.resolve([]),
      this.state.hasPackageKit ? this.software.systemUpdates(refresh) : Promise.resolve({ updates: [], restartCauses: [] } satisfies SystemUpdates),
      this.software.needsRestart(),
    ]);
    this.set({
      checking: false,
      checkedAt: this.now(),
      appUpdates: apps.status === "fulfilled" ? apps.value : (this.state.appUpdates ?? []),
      appUpdatesError: apps.status === "rejected" ? message(apps.reason) : null,
      system: system.status === "fulfilled" ? system.value : (this.state.system ?? { updates: [], restartCauses: [] }),
      systemError: system.status === "rejected" ? (system.reason instanceof MissingTool ? null : message(system.reason)) : null,
      restartNeeded: restart.status === "fulfilled" ? restart.value : null,
    });
  }

  dismissFailure = (): void => this.set({ failure: null });

  /** Says a change failed (an applet's, which runs outside flatpak). */
  fail(failure: Failure): void {
    this.set({ failure });
  }

  /** Adds any change to the one queue (an applet's install, say); false when that very change waits or runs already. */
  enqueue(job: Job): boolean {
    return this.queue.enqueue(job);
  }

  install(id: string, name: string): void {
    this.queue.enqueue({
      operation: { key: `install:${id}`, kind: "install", id, name },
      start: (report, signal) => this.software.install(id, report, signal),
    });
  }

  /** Removes an app; `deleteData` also deletes its settings and data (the sheet said so first). */
  remove(app: InstalledApp, deleteData = false): void {
    this.queue.enqueue({
      operation: { key: `remove:${app.id}`, kind: "remove", id: app.id, name: app.name },
      start: (_report, signal) => this.software.remove(app.id, app.installation, signal, deleteData),
    });
  }

  /** One app's update, or (without `app`) every app update in an installation. */
  updateApp(installation: Installation, app?: { id: string; name: string }): void {
    this.queue.enqueue({
      operation: { key: `update:${installation}:${app?.id ?? "*"}`, kind: "update", ...(app ? { id: app.id } : {}), name: app?.name ?? "apps" },
      start: (report, signal) => this.software.updateFlatpak(installation, app?.id, report, signal),
    });
  }

  updateSystem(): void {
    this.queue.enqueue({
      operation: { key: "system", kind: "system-update", name: "System" },
      start: (report, signal) => this.software.updateSystem(report, signal),
    });
  }

  cancel(key: string): void {
    this.queue.cancel(key);
  }

  open(id: string): void {
    this.software.open(id);
  }

  private async finished(operation: Omit<Operation, "status" | "progress">, outcome: Outcome): Promise<void> {
    if (!outcome.ok && !outcome.cancelled) this.set({ failure: failureOf(operation, outcome.message) });
    // An applet's change reads its own folder again (its job's `done`); flatpak's lists didn't change.
    if (operation.subject === "applet") return;
    await this.refreshInstalled();
    if (operation.kind === "update" || operation.kind === "system-update") {
      await this.checkUpdates();
    } else if (outcome.ok && operation.kind === "remove") {
      // A removed app no longer has an update waiting.
      this.set({ appUpdates: (this.state.appUpdates ?? []).filter((update) => update.id !== operation.id) });
    }
  }
}
