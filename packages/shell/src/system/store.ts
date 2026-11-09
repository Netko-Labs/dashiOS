/**
 * What the menu bar shows of the machine: battery, network, and volume,
 * kept fresh by polling (and by `nmcli monitor` for the network, the
 * kernel's power-supply events for the battery, and the session's
 * `pw-dump --monitor` for the volume, which then isn't polled), as a store
 * React components subscribe to.
 */

import { useSyncExternalStore } from "react";
import { type Battery, readBattery } from "./battery.ts";
import { run as defaultRun, type Run } from "./exec.ts";
import { type Network, readNetwork } from "./network.ts";
import { readVolume, type Volume } from "./volume.ts";
import { watchLines } from "./watch.ts";

export interface SystemSnapshot {
  /** Null on a machine with no battery. */
  battery: Battery | null;
  /** Null when NetworkManager cannot be asked. */
  network: Network | null;
  /** Null without PipeWire. */
  volume: Volume | null;
}

/** How often each is read; the network also refreshes when it changes. */
/** Power-supply events come in bursts (the charger, then each battery); one read after the last. */
const POWER_DEBOUNCE_MS = 250;

export const INTERVALS = { battery: 30_000, network: 10_000, volume: 3000 } as const;

/** A burst of NetworkManager events is one refresh. */
const NETWORK_DEBOUNCE_MS = 400;

export interface SystemSources {
  battery(): Promise<Battery | null>;
  network(): Promise<Network | null>;
  volume(): Promise<Volume | null>;
  /** Tells the output volume each time PipeWire changes (sound/apps/watch.ts); with it the volume isn't polled. Returns the stop. */
  followVolume?(onVolume: (volume: Volume | null) => void): () => void;
}

export function systemSources(run: Run = defaultRun): SystemSources {
  return {
    battery: () => readBattery(),
    network: () => readNetwork(run),
    volume: () => readVolume(run),
  };
}

export class SystemStore {
  private snapshot: SystemSnapshot = { battery: null, network: null, volume: null };
  private readonly listeners = new Set<() => void>();
  private stops: Array<() => void> = [];
  /** Counts reads per value so a slow, older read cannot overwrite a newer one. */
  private readonly reads: Record<keyof SystemSnapshot, number> = { battery: 0, network: 0, volume: 0 };

  constructor(
    private readonly sources: SystemSources = systemSources(),
    private readonly monitor: (onEvent: () => void) => () => void = (onEvent) => watchLines(["nmcli", "monitor"], onEvent),
    /** The kernel's power-supply events (a charger plugged in or out), so the bar answers at once instead of at the next poll. */
    private readonly powerMonitor: (onEvent: () => void) => () => void = (onEvent) =>
      watchLines(["udevadm", "monitor", "--kernel", "--subsystem-match=power_supply"], onEvent),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SystemSnapshot => this.snapshot;

  /** Reads everything now, then keeps it fresh until the returned stop. */
  start(): () => void {
    const every = (ms: number, refresh: () => Promise<void>) => {
      void refresh();
      const timer = setInterval(() => void refresh(), ms);
      this.stops.push(() => clearInterval(timer));
    };
    every(INTERVALS.battery, () => this.refresh("battery"));
    every(INTERVALS.network, () => this.refresh("network"));
    const { followVolume } = this.sources;
    if (followVolume) {
      void this.refresh("volume");
      this.stops.push(followVolume((volume) => this.publish("volume", volume)));
    } else {
      every(INTERVALS.volume, () => this.refresh("volume"));
    }

    let debounce: ReturnType<typeof setTimeout> | undefined;
    this.stops.push(
      this.monitor(() => {
        clearTimeout(debounce);
        debounce = setTimeout(() => void this.refresh("network"), NETWORK_DEBOUNCE_MS);
      }),
      () => clearTimeout(debounce),
    );
    let powerDebounce: ReturnType<typeof setTimeout> | undefined;
    this.stops.push(
      this.powerMonitor(() => {
        clearTimeout(powerDebounce);
        powerDebounce = setTimeout(() => void this.refresh("battery"), POWER_DEBOUNCE_MS);
      }),
      () => clearTimeout(powerDebounce),
    );
    return () => this.stop();
  }

  stop(): void {
    for (const stop of this.stops.splice(0)) stop();
  }

  /** Reads one value again. */
  async refresh<K extends keyof SystemSnapshot>(key: K): Promise<void> {
    const read = ++this.reads[key];
    let value: SystemSnapshot[K];
    try {
      value = (await this.sources[key]()) as SystemSnapshot[K];
    } catch (error) {
      console.error(`dashi-shell: reading ${key} failed:`, error);
      return;
    }
    if (read === this.reads[key]) this.publish(key, value);
  }

  /** Sets a value already in hand (a key press just changed it). */
  publish<K extends keyof SystemSnapshot>(key: K, value: SystemSnapshot[K]): void {
    // A read that started before this is older than it.
    this.reads[key]++;
    // The snapshot is replaced only on a change: useSyncExternalStore
    // re-renders on every new object.
    if (JSON.stringify(this.snapshot[key]) === JSON.stringify(value)) return;
    this.snapshot = { ...this.snapshot, [key]: value };
    for (const listener of this.listeners) listener();
  }
}

export function useSystem(store: SystemStore): SystemSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
