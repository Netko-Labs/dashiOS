/**
 * The display arrangement as a service: restores what was saved for the
 * monitors that are connected (at startup, on hotplug, when the lid shuts or
 * opens), and makes changes for System Settings and agents. A change to the
 * resolution, rotation, or a screen going off is on trial: "Keep these
 * settings?" is asked of the person, and without a yes in 15 seconds the
 * old arrangement comes back, so a mode a monitor cannot show never strands
 * anyone. Everything chosen is here (docs: Bun first); the compositor only
 * places screens, keeps them apart and touching, and runs the modes.
 */

import type { Compositor } from "../compositor.ts";
import { leavesRoom } from "../displays.ts";
import type { LidSource } from "./lid.ts";
import { type Mode, type Monitor, modeFor, parseMonitors, type Rotation, setKey } from "./monitors.ts";
import { type ConfigRequest, configOf, layoutOf, planRestore, type ScaleFor, toWire } from "./plan.ts";
import type { DisplayStore } from "./saved.ts";

/** How long a trial lasts before the old arrangement returns. */
export const KEEP_SECONDS = 15;

/** The question put to the person. */
export interface KeepAsk {
  /** What changed, in a few words: "Resolution of Dell U2720Q". */
  summary: string;
  /** When the trial ends (ms since the epoch), so the sheet's countdown matches. */
  deadline: number;
  /** The person's answer: true keeps the change. */
  answer(keep: boolean): void;
}

/** Shows the question; returns the way to take it away. */
export type AskToKeep = (ask: KeepAsk) => () => void;

export interface ApplyResult {
  /** The change stands. False: it was refused, or the person did not keep it. */
  kept: boolean;
  /** The old arrangement was put back (not kept in time, or not at all). */
  reverted: boolean;
  /** Why it was refused, if it was. */
  error?: string;
}

export interface DisplayManagerOptions {
  compositor: Pick<Compositor, "request" | "on">;
  store: DisplayStore;
  scaleFor: ScaleFor;
  lid?: LidSource | null;
  /** Without it changes are kept without asking (headless runs). */
  ask?: AskToKeep;
  now?: () => number;
  later?: (fn: () => void, ms: number) => () => void;
}

export interface ChangeOptions {
  /** Ask the person to keep it (default for resolution, rotation, and turning a screen off). */
  confirm?: boolean;
  /** Who made it: Automatic refresh rate (auto-refresh.ts), or a person or an agent (the default). */
  by?: "automatic";
}

/**
 * A mode the screens run changed: put back from what was saved (`restore`:
 * login, a monitor plugged, the lid), set by Automatic refresh rate, or set
 * by a person or an agent (`manual`).
 */
export interface ModeChange {
  cause: "restore" | "automatic" | "manual";
  /** The screens whose mode was set. */
  names: readonly string[];
}

const later = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class DisplayManager {
  private queue: Promise<unknown> = Promise.resolve();
  /** The set of monitors the last restore was for: a change of state alone does not restore again. */
  private restoredFor: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly modeListeners = new Set<(change: ModeChange) => void>();
  private busy = 0;

  constructor(private readonly options: DisplayManagerOptions) {}

  /** A trial is waiting for the person's answer, or a change is being made. */
  get pending(): boolean {
    return this.busy > 0;
  }

  /** Runs when `pending` changes. */
  onPending(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Runs after a mode was set and kept (auto-refresh.ts tells its own changes from others'). */
  onModeChange(listener: (change: ModeChange) => void): () => void {
    this.modeListeners.add(listener);
    return () => this.modeListeners.delete(listener);
  }

  get lidClosed(): boolean {
    return this.options.lid?.closed ?? false;
  }

  /** Restore now and whenever monitors come, go, or the lid moves. Returns the way to stop. */
  start(): () => void {
    const stops: Array<() => void> = [];
    stops.push(this.options.compositor.on((event) => event.event === "outputs-changed" && void this.restore()));
    const lid = this.options.lid;
    if (lid) stops.push(lid.onChange(() => void this.restore(true)));
    void this.restore();
    return () => {
      for (const stop of stops) stop();
    };
  }

  async monitors(): Promise<Monitor[]> {
    return parseMonitors(await this.options.compositor.request("outputs"));
  }

  /**
   * Put the arrangement saved for the connected monitors in place (a new set
   * with nothing saved only gets its default scales). `force` does it again
   * for the same set, as when the lid moves.
   */
  restore(force = false): Promise<void> {
    return this.serial(async () => {
      const monitors = await this.monitors();
      if (monitors.length === 0) return;
      const key = setKey(monitors);
      if (!force && key === this.restoredFor) return;
      this.restoredFor = key;
      const plan = planRestore(monitors, this.options.store.get(key), { lidClosed: this.lidClosed, scaleFor: this.options.scaleFor });
      if (!plan) return;
      try {
        await this.options.compositor.request("outputs-config", toWire(plan));
      } catch (error) {
        console.error("dashi-shell: could not restore the display arrangement:", error instanceof Error ? error.message : error);
        return;
      }
      const names = plan.outputs.filter((output) => output.mode !== undefined || output.enabled === true).map((output) => output.name);
      if (names.length > 0) this.tellMode({ cause: "restore", names });
    }).catch((error) => console.error("dashi-shell: displays:", error instanceof Error ? error.message : error));
  }

  /**
   * Make `request` happen and remember the result. With `confirm` the person
   * is asked to keep it; no yes in `KEEP_SECONDS` puts the old arrangement
   * back.
   */
  apply(request: ConfigRequest, summary: string, options: ChangeOptions = {}): Promise<ApplyResult> {
    return this.serial(async (): Promise<ApplyResult> => {
      const before = await this.monitors();
      try {
        await this.options.compositor.request("outputs-config", toWire(request));
      } catch (error) {
        return { kept: false, reverted: false, error: error instanceof Error ? error.message : String(error) };
      }
      const after = await this.monitors();
      this.restoredFor = setKey(after);
      if (options.confirm && this.options.ask) {
        const keep = await this.trial(summary);
        if (!keep) {
          await this.options.compositor.request("outputs-config", toWire(configOf(before))).catch((error) => {
            console.error("dashi-shell: could not put the displays back:", error instanceof Error ? error.message : error);
          });
          return { kept: false, reverted: true };
        }
      }
      this.remember(after);
      return { kept: true, reverted: false };
    });
  }

  // The changes people and agents make, each as a request over the current state.

  /** Run another resolution and refresh rate; the scale is kept if the screen still has room at it. */
  async setMode(
    name: string,
    mode: Pick<Mode, "width" | "height"> & { refreshMhz?: number },
    options: ChangeOptions = { confirm: true },
  ): Promise<ApplyResult> {
    const monitor = await this.find(name);
    if (typeof monitor === "string") return refused(monitor);
    if (!monitor.enabled) return refused(`${monitor.name} is off`);
    const offered = modeFor(monitor.modes, mode, mode.refreshMhz);
    if (!offered) return refused(`${monitor.name} has no ${mode.width} × ${mode.height} mode`);
    const scale = this.scaleAfter(monitor, offered, monitor.rotation);
    const result = await this.apply(
      {
        outputs: [
          {
            name: monitor.name,
            mode: { width: offered.width, height: offered.height, refreshMhz: offered.refreshMhz },
            ...(scale !== monitor.scale ? { scale } : {}),
          },
        ],
      },
      `Resolution of ${monitor.name}`,
      options,
    );
    if (result.kept) this.tellMode({ cause: options.by === "automatic" ? "automatic" : "manual", names: [monitor.name] });
    return result;
  }

  /** Turn a screen (0, 90, 180, 270 degrees counter-clockwise); the scale is kept if the turned screen still has room at it. */
  async setRotation(name: string, rotation: Rotation, options: ChangeOptions = { confirm: true }): Promise<ApplyResult> {
    const monitor = await this.find(name);
    if (typeof monitor === "string") return refused(monitor);
    if (!monitor.enabled || !monitor.mode) return refused(`${monitor.name} is off`);
    const scale = this.scaleAfter(monitor, monitor.mode, rotation);
    return this.apply(
      { outputs: [{ name: monitor.name, rotation, flipped: monitor.flipped, ...(scale !== monitor.scale ? { scale } : {}) }] },
      `Rotation of ${monitor.name}`,
      options,
    );
  }

  /** Move the menu bar and Dock to this screen. */
  async setPrimary(name: string): Promise<ApplyResult> {
    const monitor = await this.find(name);
    if (typeof monitor === "string") return refused(monitor);
    if (!monitor.enabled) return refused(`${monitor.name} is off`);
    return this.apply({ outputs: [], primary: monitor.name }, `Main display ${monitor.name}`);
  }

  /** Move screens to these places (points); the compositor keeps them apart and touching. */
  async arrange(positions: Readonly<Record<string, { x: number; y: number }>>): Promise<ApplyResult> {
    const monitors = await this.monitors();
    const unknown = Object.keys(positions).find((name) => !monitors.some((monitor) => monitor.name === name && monitor.enabled));
    if (unknown !== undefined) return refused(`there is no screen ${unknown} that is on`);
    return this.apply({ outputs: Object.entries(positions).map(([name, position]) => ({ name, position })) }, "Arrangement");
  }

  /** Turn a monitor on or off (never the last one on). */
  async setEnabled(name: string, enabled: boolean, options: ChangeOptions = { confirm: !enabled }): Promise<ApplyResult> {
    const monitor = await this.find(name);
    if (typeof monitor === "string") return refused(monitor);
    return this.apply({ outputs: [{ name: monitor.name, enabled }] }, `${enabled ? "Turning on" : "Turning off"} ${monitor.name}`, options);
  }

  // Internals.

  private async find(name: string): Promise<Monitor | string> {
    const monitor = (await this.monitors()).find((candidate) => candidate.name === name);
    return monitor ?? `there is no screen called “${name}”`;
  }

  /** The scale the screen keeps running `mode` turned by `rotation`: its own if there is room, else the default. */
  private scaleAfter(monitor: Monitor, mode: Mode, rotation: Rotation): number {
    const upright = rotation === 90 || rotation === 270 ? { width: mode.height, height: mode.width } : { width: mode.width, height: mode.height };
    return leavesRoom(upright, monitor.scale) ? monitor.scale : this.options.scaleFor(monitor, mode, rotation);
  }

  private tellMode(change: ModeChange): void {
    for (const listener of [...this.modeListeners]) listener(change);
  }

  private remember(monitors: readonly Monitor[]): void {
    const key = setKey(monitors);
    this.options.store.set(key, layoutOf(monitors, this.options.store.get(key), this.lidClosed));
  }

  /** Asks the person; true to keep. No answer in time is no. */
  private trial(summary: string): Promise<boolean> {
    const ask = this.options.ask;
    if (!ask) return Promise.resolve(true);
    const now = this.options.now ?? Date.now;
    const schedule = this.options.later ?? later;
    return new Promise<boolean>((resolve) => {
      let take = (): void => {};
      let cancel = (): void => {};
      let settled = false;
      const finish = (keep: boolean): void => {
        console.error("KEEP finish", keep, new Error().stack?.split("\n").slice(2, 5).join("|"));
        if (settled) return;
        settled = true;
        cancel();
        take();
        resolve(keep);
      };
      take = ask({ summary, deadline: now() + KEEP_SECONDS * 1000, answer: finish });
      // The sheet may have answered while it opened.
      if (settled) take();
      else cancel = schedule(() => finish(false), KEEP_SECONDS * 1000);
    });
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    this.changeBusy(1);
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run.finally(() => this.changeBusy(-1));
  }

  private changeBusy(delta: number): void {
    const was = this.busy > 0;
    this.busy += delta;
    if (was !== this.busy > 0) for (const listener of [...this.listeners]) listener();
  }
}

const refused = (error: string): ApplyResult => ({ kept: false, reverted: false, error });
