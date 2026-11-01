/**
 * Software's hands: what is installed, what has updates, and installing,
 * removing, and updating through `flatpak` and PackageKit's `pkcon`. Used by
 * the Software app and by the agents' tools alike, so both do the same thing
 * the same way. Every command is an argument list (flatpak-cmd.ts) run through
 * an injectable `Runner`; nothing here shows UI or asks anyone anything.
 */

import { spawnDetached } from "../menus/launch.ts";
import * as cmd from "./flatpak-cmd.ts";
import { failureMessage, type FlatpakUpdate, type InstalledApp, parseList, parseProgress, parseUpdates } from "./flatpak-parse.ts";
import { type Installation, isAppId } from "./ids.ts";
import { parseSystemProgress, parseUpdateList, pkconError, restartCauses, restartNeeded, type SystemUpdate, systemFailure } from "./pkcon.ts";
import { type RunResult, run as defaultRun, type Runner } from "./run.ts";

export interface Progress {
  /** 0 to 1, or null while it is not known (shown as busy). */
  fraction: number | null;
  label: string;
}

export interface Outcome {
  ok: boolean;
  cancelled?: boolean;
  /** Why it failed, in a sentence. */
  message: string;
}

export type OnProgress = (progress: Progress) => void;

export class MissingTool extends Error {
  constructor(readonly tool: "flatpak" | "pkcon") {
    super(tool === "flatpak" ? "Flatpak is not installed." : "PackageKit is not installed.");
  }
}

export interface SystemUpdates {
  updates: SystemUpdate[];
  /** Updates after which a restart is needed to finish. */
  restartCauses: SystemUpdate[];
}

export interface ManagerDeps {
  run?: Runner;
  which?: (program: string) => string | null;
  launch?: (command: readonly string[]) => void;
}

/** A tail of terminal output is enough to find the progress bar in. */
const KEEP = 20_000;

export class Software {
  private readonly run: Runner;
  private readonly which: (program: string) => string | null;
  private readonly launch: (command: readonly string[]) => void;

  constructor(deps: ManagerDeps = {}) {
    this.run = deps.run ?? defaultRun;
    this.which = deps.which ?? ((program) => Bun.which(program));
    this.launch = deps.launch ?? spawnDetached;
  }

  get hasFlatpak(): boolean {
    return this.which("flatpak") !== null;
  }

  get hasPackageKit(): boolean {
    return this.which("pkcon") !== null;
  }

  private need(tool: "flatpak" | "pkcon"): void {
    if (this.which(tool) === null) throw new MissingTool(tool);
  }

  /** Every flatpak app installed, for the user and the system. */
  async installed(): Promise<InstalledApp[]> {
    this.need("flatpak");
    const result = await this.run(cmd.list(), { timeoutMs: 60_000 });
    if (result.code !== 0) throw new Error(failureMessage(result.output));
    return parseList(result.output);
  }

  /** Flatpak app updates waiting, user and system. One installation failing (no system flatpak data) does not hide the other's. */
  async flatpakUpdates(): Promise<FlatpakUpdate[]> {
    this.need("flatpak");
    const each = await Promise.all(
      (["user", "system"] as const).map(async (installation) => {
        const result = await this.run(cmd.updatesAvailable(installation), { timeoutMs: 120_000 });
        return result.code === 0 ? { ok: true as const, updates: parseUpdates(result.output, installation) } : { ok: false as const, message: failureMessage(result.output) };
      }),
    );
    const failed = each.find((entry) => !entry.ok);
    if (failed && !failed.ok && each.every((entry) => !entry.ok)) throw new Error(failed.message);
    return each.flatMap((entry) => (entry.ok ? entry.updates : []));
  }

  /** The system's pending updates; `refresh` first asks PackageKit to look for new ones (polkit may ask). */
  async systemUpdates(refresh = false): Promise<SystemUpdates> {
    this.need("pkcon");
    if (refresh) await this.run(cmd.pkconRefresh(), { timeoutMs: 180_000 });
    const result = await this.run(cmd.pkconGetUpdates(), { timeoutMs: 180_000 });
    if (result.code !== 0 || pkconError(result.output) !== null) throw new Error(systemFailure(result.output));
    const updates = parseUpdateList(result.output);
    return { updates, restartCauses: restartCauses(updates) };
  }

  /** Whether the system needs a restart to finish earlier updates (null when it can't tell). */
  async needsRestart(): Promise<boolean | null> {
    if (this.which("dnf") === null) return null;
    const result = await this.run(cmd.needsRestarting(), { timeoutMs: 120_000 });
    return restartNeeded(result.code, result.output);
  }

  /** Adds the user's Flathub remote (a no-op when it exists), then installs for the user. */
  async install(id: string, onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    this.need("flatpak");
    if (!isAppId(id)) return { ok: false, message: "That is not an application id." };
    onProgress({ fraction: null, label: "Preparing" });
    const remote = await this.run(cmd.remoteAdd(), { signal, timeoutMs: 60_000 });
    if (signal?.aborted) return { ok: false, cancelled: true, message: "Cancelled." };
    if (remote.code !== 0) return { ok: false, message: `Flathub could not be added: ${failureMessage(remote.output)}` };
    return this.flatpak((progress) => cmd.install(id, progress), onProgress, signal);
  }

  remove(id: string, installation: Installation, signal?: AbortSignal): Promise<Outcome> {
    this.need("flatpak");
    return this.flatpak(() => cmd.uninstall(id, installation), () => {}, signal, false);
  }

  /** Updates one app, or all of an installation's. */
  updateFlatpak(installation: Installation, id: string | undefined, onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    this.need("flatpak");
    return this.flatpak((progress) => cmd.update(installation, id, progress), onProgress, signal);
  }

  /** Installs every pending system update through PackageKit; polkit asks for the password. */
  async updateSystem(onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    this.need("pkcon");
    onProgress({ fraction: null, label: "Starting" });
    let seen = "";
    const result = await this.run(cmd.pkconUpdate(), {
      signal,
      timeoutMs: 3 * 60 * 60_000,
      onOutput: (chunk) => {
        seen = (seen + chunk).slice(-KEEP);
        const progress = parseSystemProgress(seen);
        if (progress) onProgress(progress);
      },
    });
    // pkcon can fail and still exit 0 (no PackageKit daemon).
    return this.outcome(pkconError(result.output) !== null && result.code === 0 ? { ...result, code: 1 } : result, signal, systemFailure(result.output));
  }

  /** Starts an installed app, detached from Software. */
  open(id: string): void {
    this.launch(cmd.runApp(id));
  }

  /** Runs a flatpak command; `progress` runs it on a terminal so its progress bar can be read (removing has none). */
  private async flatpak(build: (progress: boolean) => string[], onProgress: OnProgress, signal?: AbortSignal, progress = true): Promise<Outcome> {
    onProgress({ fraction: null, label: progress ? "Working" : "Removing" });
    let seen = "";
    const watch = (chunk: string): void => {
      seen = (seen + chunk).slice(-KEEP);
      const progress = parseProgress(seen);
      if (progress) onProgress(progress);
    };
    const limit = 3 * 60 * 60_000;
    let result: RunResult = progress ? await this.run(build(true), { terminal: true, onOutput: watch, signal, timeoutMs: limit }) : { code: null, output: "" };
    // No terminal to be had (or none wanted): the quiet command does the work, with no progress to show.
    if (result.code === null && !signal?.aborted) result = await this.run(build(false), { signal, timeoutMs: limit });
    return this.outcome(result, signal, failureMessage(result.output));
  }

  private outcome(result: RunResult, signal: AbortSignal | undefined, failure: string): Outcome {
    if (signal?.aborted) return { ok: false, cancelled: true, message: "Cancelled." };
    if (result.code === 0) return { ok: true, message: "" };
    return { ok: false, message: failure };
  }
}
