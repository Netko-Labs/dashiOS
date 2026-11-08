/**
 * The battery monitor: while the shell runs on a machine with a battery, a
 * sample a minute goes into the history (history.ts, file.ts) and every half
 * minute the apps' processor use is measured (apps.ts). What it knows is one
 * snapshot, read by the battery's menu and Settings' Battery & Power pane:
 * the draw now, the week's samples, the apps using energy, and the insights
 * (insights.ts). On a machine without a battery it does nothing.
 */

import { useSyncExternalStore } from "react";
import type { ProcessSample } from "../../apps/activity-monitor/read.ts";
import { type Battery, type readPowerSupplies, summarizeBattery } from "../system/battery.ts";
import { type AppUse, averageUse, ownerOf, significant, usageBetween, type WindowOwner } from "./apps.ts";
import type { HistoryFile } from "./file.ts";
import { drawWatts, prune, type Sample } from "./history.ts";
import { type Insight, insights } from "./insights.ts";
import { type Adapter, adapterOf } from "./panel-numbers.ts";

export const MONITOR = {
  /** A history sample. */
  sampleMs: 60_000,
  /** A look at the apps. */
  appsMs: 30_000,
  /** The looks averaged for "the last minutes": ten minutes' worth. */
  appWindow: 20,
} as const;

export interface BatteryMonitorState {
  /** False until the first read, and on a machine with no battery. */
  available: boolean;
  battery: Battery | null;
  /** Watts now; null when the battery doesn't say. */
  watts: number | null;
  /** The week's samples, oldest first. */
  samples: readonly Sample[];
  /** Every app's processor use over the last minutes, heaviest first. */
  apps: readonly AppUse[];
  /** The ones of `apps` using significant energy. */
  significant: readonly AppUse[];
  insights: readonly Insight[];
  /** The charger's rating and draw as its power_supply entry says (the battery panel). */
  adapter: Adapter;
}

const NO_ADAPTER: Adapter = { rating: null, input: null };

const EMPTY: BatteryMonitorState = { available: false, battery: null, watts: null, samples: [], apps: [], significant: [], insights: [], adapter: NO_ADAPTER };

export interface MonitorSources {
  supplies: typeof readPowerSupplies;
  /** The processes now, by pid. */
  processes(): ReadonlyMap<number, ProcessSample>;
  /** The windows on screen with their processes and apps. */
  windows(): Promise<readonly WindowOwner[]>;
  /** Battery health in percent, null when unknown. */
  health(): Promise<number | null>;
  /** Whether Low Power is on; null without power modes. */
  lowPower(): Promise<boolean | null>;
  file: Pick<HistoryFile, "read" | "append">;
  uid: number;
  hz: number;
  /** Seconds since the epoch. */
  now(): number;
}

export class BatteryMonitor {
  private state: BatteryMonitorState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private samples: Sample[] = [];
  private measurements: AppUse[][] = [];
  private last: { at: number; processes: ReadonlyMap<number, ProcessSample> } | null = null;
  private health: number | null = null;
  private lowPower: boolean | null = null;
  private adapter: Adapter = NO_ADAPTER;
  private stopped = false;

  constructor(private readonly sources: MonitorSources) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BatteryMonitorState => this.state;

  /** Reads the history and starts sampling, if this machine has a battery. */
  async start(): Promise<void> {
    const battery = summarizeBattery(await this.sources.supplies());
    if (!battery || this.stopped) return;
    this.samples = this.sources.file.read(this.sources.now());
    await this.refreshSlow();
    await this.sample();
    this.look();
    this.timers.push(
      setInterval(() => void this.sample(), MONITOR.sampleMs),
      setInterval(() => this.look(), MONITOR.appsMs),
      // Health and the power mode change rarely: every ten minutes.
      setInterval(() => void this.refreshSlow(), 10 * MONITOR.sampleMs),
    );
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.listeners.clear();
  }

  /** A history sample now (also when the battery changed state, so a plug-in shows at once). */
  async sample(): Promise<void> {
    const supplies = await this.sources.supplies();
    const battery = summarizeBattery(supplies);
    if (!battery) return;
    const now = this.sources.now();
    const sample: Sample = { t: Math.round(now), percent: battery.percent, state: battery.state, watts: drawWatts(supplies) };
    this.samples = prune([...this.samples, sample], now);
    this.adapter = adapterOf(supplies);
    this.sources.file.append(sample);
    this.publish(battery, sample.watts);
  }

  private look(): void {
    let processes: ReadonlyMap<number, ProcessSample>;
    try {
      processes = this.sources.processes();
    } catch {
      return;
    }
    const at = this.sources.now();
    const before = this.last;
    this.last = { at, processes };
    if (!before) return;
    void this.sources.windows().then((windows) => {
      const use = usageBetween(before.processes, processes, at - before.at, {
        uid: this.sources.uid,
        hz: this.sources.hz,
        owner: ownerOf(processes, windows),
      });
      this.measurements = [...this.measurements, use].slice(-MONITOR.appWindow);
      if (this.state.battery) this.publish(this.state.battery, this.state.watts);
    });
  }

  private async refreshSlow(): Promise<void> {
    [this.health, this.lowPower] = await Promise.all([this.sources.health().catch(() => null), this.sources.lowPower().catch(() => null)]);
  }

  private publish(battery: Battery, watts: number | null): void {
    const apps = averageUse(this.measurements);
    const heavy = significant(apps);
    this.state = {
      available: true,
      battery,
      watts,
      samples: this.samples,
      apps,
      significant: heavy,
      insights: insights({ now: this.sources.now(), battery, health: this.health, watts, samples: this.samples, apps: heavy, lowPower: this.lowPower }),
      adapter: this.adapter,
    };
    for (const listener of this.listeners) listener();
  }
}

export function useBatteryMonitor(monitor: BatteryMonitor): BatteryMonitorState {
  return useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
}
