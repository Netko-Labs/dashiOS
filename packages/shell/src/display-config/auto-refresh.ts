/**
 * Automatic refresh rate, as the shell runs it: the built-in screen at its
 * top rate plugged in and about 60 Hz on battery (refresh-policy.ts decides).
 * It sets the rate at login, when the power source changes (once the new
 * source has held for `POWER_STEADY_MS`, steady.ts), when Automatic is
 * turned on in Displays, and after the saved arrangement is put back (a
 * monitor plugged in, the lid opened). Nothing else moves it.
 *
 * Never fighting another choice: a mode set any other way for the session
 * (Displays' resolution, an agent's `set_display_mode`) holds that screen
 * until the power source next changes. While the screens are blanked or the
 * session is locked nothing is set; the change waits for them to come back.
 * Its own changes go through the display manager without asking to keep
 * them (the panel's own modes, at the size it runs) and are saved with the
 * arrangement, so putting it back doesn't undo them.
 */

import { useSyncExternalStore } from "react";
import type { DisplayManager, ModeChange } from "./manager.ts";
import type { Monitor } from "./monitors.ts";
import { type AutoRates, autoRates, decideRefresh, type RefreshChoice, type RefreshDecision } from "./refresh-policy.ts";
import { type Later, Steady } from "./steady.ts";

/** How long a new power source has to hold before the rate follows it. */
export const POWER_STEADY_MS = 5000;

export interface RefreshScreen {
  name: string;
  choice: RefreshChoice;
  /** The two rates Automatic moves between; null where it isn't offered. */
  rates: AutoRates | null;
  decision: RefreshDecision;
}

export interface RefreshSnapshot {
  /** The power source the rate follows; null until it is known. */
  plugged: boolean | null;
  /** The built-in screens. */
  screens: readonly RefreshScreen[];
}

export interface AutoRefreshDeps {
  displays: Pick<DisplayManager, "monitors" | "setMode" | "onModeChange">;
  /** The choice saved for a screen (settings.json `displays.<name>.refresh`; absent is Automatic). */
  choice(name: string): RefreshChoice;
  /** A mode can be set now: the screens aren't blanked and the session isn't locked. */
  ready(): boolean;
  /** Runs the listener when the screens change (the compositor's `outputs-changed`), so the snapshot stays current. */
  watch?(listener: () => void): () => void;
  later?: Later;
}

export class AutoRefresh {
  private snapshot: RefreshSnapshot = { plugged: null, screens: [] };
  private readonly listeners = new Set<() => void>();
  private readonly power: Steady<boolean>;
  /** Screens whose mode was set another way since the power source last changed. */
  private readonly held = new Set<string>();
  private choices = new Map<string, RefreshChoice>();
  /** A change waits for the screens to light or the session to unlock. */
  private waiting = false;
  private queue: Promise<void> = Promise.resolve();
  private stops: Array<() => void> = [];

  constructor(private readonly deps: AutoRefreshDeps) {
    this.power = new Steady(POWER_STEADY_MS, (plugged) => this.powerSettled(plugged), deps.later);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RefreshSnapshot => this.snapshot;

  /** Follow the display manager's changes (and the screens, with `watch`). Returns the way to stop. */
  start(): () => void {
    this.stops.push(this.deps.displays.onModeChange((change) => this.modeChanged(change)));
    if (this.deps.watch) this.stops.push(this.deps.watch(() => void this.run(false)));
    return () => this.close();
  }

  close(): void {
    for (const stop of this.stops) stop();
    this.stops = [];
    this.power.close();
  }

  /** The power source now (as often as it is read): the first counts at once, a change once it holds. */
  setPlugged(plugged: boolean): void {
    this.power.set(plugged);
  }

  /** settings.json changed: a screen turned to Automatic gets its rate now. */
  settingsChanged(): void {
    let turnedOn = false;
    for (const screen of this.snapshot.screens) {
      const choice = this.deps.choice(screen.name);
      if (choice === "automatic" && this.choices.get(screen.name) !== "automatic") {
        this.held.delete(screen.name);
        turnedOn = true;
      }
    }
    void this.run(turnedOn);
  }

  /** The screens lit again or the session unlocked: a change that waited is made now. */
  readyChanged(): void {
    if (this.waiting && this.deps.ready()) void this.run(true);
  }

  /** Resolves when no decision is running or queued (tests). */
  async idle(): Promise<void> {
    let seen: Promise<void> | null = null;
    while (seen !== this.queue) {
      seen = this.queue;
      await seen;
    }
  }

  private powerSettled(plugged: boolean): void {
    // A new power source: whatever was set by hand for the session gives way.
    this.held.clear();
    this.snapshot = { ...this.snapshot, plugged };
    this.notify();
    void this.run(true);
  }

  private modeChanged(change: ModeChange): void {
    if (change.cause === "manual") for (const name of change.names) this.held.add(name);
    void this.run(change.cause === "restore");
  }

  /** Read the screens and decide; with `act`, set what the decision says. One at a time. */
  private run(act: boolean): Promise<void> {
    const next = this.queue.then(() => this.decide(act));
    this.queue = next.catch((error) => console.error("dashi-shell: refresh rate:", error instanceof Error ? error.message : error));
    return this.queue;
  }

  private async decide(act: boolean): Promise<void> {
    const plugged = this.snapshot.plugged;
    const monitors = (await this.deps.displays.monitors()).filter((monitor) => monitor.builtIn);
    const screens = monitors.map((monitor) => this.screenOf(monitor, plugged ?? true));
    this.publish(screens);
    if (!act || plugged === null) return;
    for (const screen of screens) {
      const mode = screen.decision.set;
      if (!mode) continue;
      if (!this.deps.ready()) {
        this.waiting = true;
        return;
      }
      const result = await this.deps.displays.setMode(screen.name, mode, { confirm: false, by: "automatic" });
      if (result.error) console.error(`dashi-shell: refresh rate: ${screen.name} stays as it is: ${result.error}`);
    }
    this.waiting = false;
  }

  private screenOf(monitor: Monitor, plugged: boolean): RefreshScreen {
    const choice = this.deps.choice(monitor.name);
    const decision = decideRefresh({ choice, plugged, monitor, held: this.held.has(monitor.name) });
    return { name: monitor.name, choice, rates: autoRates(monitor), decision };
  }

  private publish(screens: readonly RefreshScreen[]): void {
    this.choices = new Map(screens.map((screen) => [screen.name, screen.choice]));
    const next: RefreshSnapshot = { ...this.snapshot, screens };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function useAutoRefresh(refresh: AutoRefresh): RefreshSnapshot {
  return useSyncExternalStore(refresh.subscribe, refresh.getSnapshot);
}

/** The first built-in screen where Automatic is offered (the one Battery & Power speaks of). */
export function builtInScreen(snapshot: RefreshSnapshot): RefreshScreen | null {
  return snapshot.screens.find((screen) => screen.decision.offered) ?? null;
}
