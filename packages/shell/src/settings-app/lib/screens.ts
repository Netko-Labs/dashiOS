/**
 * The screens Settings lists, and the scale choice for each. The compositor
 * knows the screens (IPC `outputs`) and changes a scale at once (IPC `output`);
 * the choice is also written to settings.json so the next session starts with
 * it (displays.ts reads it back).
 */

import type { Compositor } from "../../compositor.ts";
import type { ApplyResult, DisplayManager } from "../../display-config/manager.ts";
import { mirrorRequests } from "../../display-config/mirror.ts";
import { type Mode, type Monitor, monitorsOf, type Rotation, type VrrMode } from "../../display-config/monitors.ts";
import { toWire } from "../../display-config/plan.ts";
import { SCALES, type ScreenInfo, screensOf } from "../../displays.ts";
import type { SettingsStore } from "../store.ts";

/** A scaled screen keeps at least this much room, so Settings never offers a scale that leaves nothing to click on. */
const MIN_LOGICAL = { width: 800, height: 480 } as const;

/** "125%": the way scales are named to people. */
export function scaleLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** What the screen's pixels look like at `scale`, in logical pixels. */
export function logicalSize(screen: ScreenInfo, scale: number): { width: number; height: number } {
  return { width: Math.round(screen.width / scale), height: Math.round(screen.height / scale) };
}

/** The scales to offer: those that leave room, and always the one in use. */
export function scaleChoices(screen: ScreenInfo): number[] {
  return SCALES.filter((scale) => {
    const size = logicalSize(screen, scale);
    return scale === screen.scale || (size.width >= MIN_LOGICAL.width && size.height >= MIN_LOGICAL.height);
  });
}

/** Whether `scale` is the screen's (the compositor reports fractional scales exactly as set, up to rounding). */
export const isCurrentScale = (screen: ScreenInfo, scale: number): boolean => Math.abs(screen.scale - scale) < 0.005;

/** What the Displays pane asks of the arrangement service (display-config/manager.ts). */
export type Arranger = Pick<DisplayManager, "setMode" | "setRotation" | "setPrimary" | "setEnabled" | "arrange" | "onPending" | "pending">;

export interface ScreensState {
  screens: readonly ScreenInfo[];
  /** The same monitors with their identity, modes, and rotation, and those that are off. */
  monitors: readonly Monitor[];
  /** A change is being made, or waits for the person to keep it. */
  busy: boolean;
  /** The first answer has come (or failed). */
  loaded: boolean;
  /** Why the last scale change was refused, null otherwise. */
  error: string | null;
}

export class ScreensStore {
  private snapshot: ScreensState = { screens: [], monitors: [], busy: false, loaded: false, error: null };
  private readonly listeners = new Set<() => void>();

  /** `compositor` null is a run without dashi-comp: no screens. */
  constructor(
    private readonly compositor: Pick<Compositor, "outputs" | "output" | "outputsConfig" | "mirror" | "on"> | null,
    private readonly settings: Pick<SettingsStore, "setDisplayScale" | "setDisplayVrr" | "setDisplayRefresh">,
    /** Null without the arrangement service: the pane shows the screens and their scales only. */
    private readonly displays: Arranger | null = null,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ScreensState => this.snapshot;

  /** Load the screens and follow them while the page is open. */
  start(): () => void {
    void this.refresh();
    const stopBusy = this.displays?.onPending(() => this.set({ ...this.snapshot, busy: this.displays?.pending ?? false }));
    const stopOutputs = this.compositor?.on((event) => event.event === "outputs-changed" && void this.refresh());
    return () => {
      stopBusy?.();
      stopOutputs?.();
    };
  }

  async refresh(): Promise<void> {
    if (!this.compositor) return this.set({ ...this.snapshot, loaded: true });
    try {
      const answer = await this.compositor.outputs();
      this.set({ ...this.snapshot, screens: screensOf(answer), monitors: monitorsOf(answer), loaded: true });
    } catch (error) {
      this.set({ ...this.snapshot, loaded: true, error: message(error) });
    }
  }

  /** Apply a scale now and remember it. A refusal is shown and nothing is saved. */
  async setScale(name: string, scale: number): Promise<void> {
    if (!this.compositor) return;
    try {
      await this.compositor.output({ name, scale });
    } catch (error) {
      this.set({ ...this.snapshot, error: message(error) });
      return;
    }
    this.settings.setDisplayScale(name, scale);
    this.set({ ...this.snapshot, error: null });
    await this.refresh();
  }

  /** Variable refresh rate for a screen, now and at the next login. A refusal is shown and nothing is saved. */
  async setVrr(name: string, vrr: VrrMode): Promise<void> {
    if (!this.compositor) return;
    try {
      await this.compositor.outputsConfig(toWire({ outputs: [{ name, vrr }] }));
    } catch (error) {
      this.set({ ...this.snapshot, error: message(error) });
      return;
    }
    this.settings.setDisplayVrr(name, vrr === "off" ? undefined : vrr);
    this.set({ ...this.snapshot, error: null });
    await this.refresh();
  }

  /** Run another resolution and rate. The person is asked to keep it. Each change resolves true when it was kept. */
  setMode(name: string, mode: Mode): Promise<boolean> {
    return this.change((displays) => displays.setMode(name, mode));
  }

  /**
   * The refresh rate row: Automatic (the rate follows the power source,
   * display-config/auto-refresh.ts), or a rate, which turns Automatic off for
   * the screen once it is kept (the person is asked, as for any mode).
   */
  async setRate(name: string, rate: number | "automatic"): Promise<void> {
    if (rate === "automatic") {
      this.settings.setDisplayRefresh(name, "automatic");
      return;
    }
    const monitor = this.snapshot.monitors.find((candidate) => candidate.name === name);
    const mode = monitor?.mode;
    if (!mode) return;
    if (Math.abs(mode.refreshMhz - rate) <= 600) {
      this.settings.setDisplayRefresh(name, "fixed");
      return;
    }
    const kept = await this.change((displays) => displays.setMode(name, { width: mode.width, height: mode.height, refreshMhz: rate }));
    if (kept) this.settings.setDisplayRefresh(name, "fixed");
  }

  setRotation(name: string, rotation: Rotation): Promise<boolean> {
    return this.change((displays) => displays.setRotation(name, rotation));
  }

  /** Make this the main display: the menu bar and Dock move to it. */
  setPrimary(name: string): Promise<boolean> {
    return this.change((displays) => displays.setPrimary(name));
  }

  setEnabled(name: string, enabled: boolean): Promise<boolean> {
    return this.change((displays) => displays.setEnabled(name, enabled));
  }

  /** The other screens show the built-in one (display-config/mirror.ts), or each its own again. A refusal is shown. */
  async setMirroring(on: boolean): Promise<void> {
    if (!this.compositor) return;
    try {
      for (const request of mirrorRequests(this.snapshot.monitors, on)) await this.compositor.mirror(request);
      this.set({ ...this.snapshot, error: null });
    } catch (error) {
      this.set({ ...this.snapshot, error: message(error) });
    }
    await this.refresh();
  }

  /** Move screens to these places (points); the compositor keeps them apart and touching. */
  arrange(positions: Readonly<Record<string, { x: number; y: number }>>): Promise<boolean> {
    return this.change((displays) => displays.arrange(positions));
  }

  /** Makes the change; true when it was kept. */
  private async change(make: (displays: Arranger) => Promise<ApplyResult>): Promise<boolean> {
    if (!this.displays) return false;
    let result: ApplyResult;
    try {
      result = await make(this.displays);
    } catch (error) {
      result = { kept: false, reverted: false, error: message(error) };
    }
    this.set({ ...this.snapshot, error: result.error ?? null });
    await this.refresh();
    return result.kept;
  }

  private set(next: ScreensState): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
