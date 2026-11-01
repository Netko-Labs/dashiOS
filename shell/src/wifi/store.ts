/**
 * The Wi-Fi list and the join in flight, as a store React components
 * subscribe to. Opening the menu reads the list at once from what
 * NetworkManager already knows and asks for a scan; the list follows the scan
 * as access points appear. Joining is one at a time, and its outcome stays
 * until the next try so the sheet (or the list) can say what happened.
 */

import { useSyncExternalStore } from "react";
import { buildNetworks, canJoinNew } from "./networks.ts";
import type { JoinFailure, JoinResult, SavedNetwork, WifiBackend, WifiNetwork } from "./types.ts";

export type JoinState =
  | { phase: "idle" }
  | { phase: "joining"; key: string; ssid: string }
  | { phase: "failed"; key: string; ssid: string; reason: JoinFailure };

export interface WifiState {
  /** Null until the first read; false when NetworkManager or a Wi-Fi device is missing. */
  available: boolean | null;
  scanning: boolean;
  /** The network the device is connected to. */
  current: WifiNetwork | null;
  /** The other networks, known ones first, then by signal. */
  networks: readonly WifiNetwork[];
  /** Every network with a saved profile, in range or not (Settings' Known Networks). */
  saved: readonly SavedNetwork[];
  join: JoinState;
}

export interface WifiStoreOptions {
  /** A burst of access-point changes is one read. */
  debounceMs?: number;
  /** The connection changed (a join worked): the menu bar should look again. */
  networkChanged?: () => void;
}

const INITIAL: WifiState = { available: null, scanning: false, current: null, networks: [], saved: [], join: { phase: "idle" } };

export class WifiStore {
  private snapshot: WifiState = INITIAL;
  private readonly listeners = new Set<() => void>();
  /** Counts reads so a slow, older one cannot overwrite a newer one. */
  private reads = 0;
  private stopWatching: (() => void) | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private complained = false;

  constructor(
    private readonly backend: WifiBackend,
    private readonly options: WifiStoreOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WifiState => this.snapshot;

  /** The menu opened: read, scan, and follow changes until `close`. */
  open(): void {
    this.stopWatching ??= this.backend.watch(() => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.refresh(), this.options.debounceMs ?? 300);
    });
    void this.refresh();
    void this.rescan();
  }

  close(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    clearTimeout(this.debounce);
    // An old failure is not news the next time the menu opens.
    if (this.snapshot.join.phase === "failed") this.publish({ join: { phase: "idle" } });
  }

  async refresh(): Promise<void> {
    const read = ++this.reads;
    try {
      const reading = await this.backend.read();
      if (read !== this.reads) return;
      this.complained = false;
      if (reading.kind === "unavailable") return this.publish({ available: false, current: null, networks: [], saved: [] });
      const { current, others, saved } = buildNetworks(reading);
      this.publish({ available: true, current, networks: others, saved });
    } catch (error) {
      if (read !== this.reads) return;
      if (!this.complained) console.error("dashi-shell: Wi-Fi: NetworkManager cannot be asked:", error instanceof Error ? error.name : "error");
      this.complained = true;
      this.publish({ available: false, current: null, networks: [], saved: [] });
    }
  }

  async rescan(): Promise<void> {
    if (this.snapshot.scanning) return;
    this.publish({ scanning: true });
    try {
      await this.backend.scan();
    } catch {
      // Nothing to scan with; the read says so.
    }
    this.publish({ scanning: false });
    await this.refresh();
  }

  /** Joins `network`. The password is passed through, never kept. */
  async join(network: WifiNetwork, password: string | null = null): Promise<JoinResult> {
    if (this.snapshot.join.phase === "joining") return { ok: false, reason: "failed" };
    const { key, ssid } = network;
    if (!network.known && !canJoinNew(network.security)) {
      this.publish({ join: { phase: "failed", key, ssid, reason: "unsupported" } });
      return { ok: false, reason: "unsupported" };
    }
    this.publish({ join: { phase: "joining", key, ssid } });
    let result: JoinResult;
    try {
      result = await this.backend.join(network, password);
    } catch {
      result = { ok: false, reason: "failed" };
    }
    this.publish({ join: result.ok ? { phase: "idle" } : { phase: "failed", key, ssid, reason: result.reason } });
    if (result.ok) {
      await this.refresh();
      this.options.networkChanged?.();
    }
    return result;
  }

  /** Forgets a saved network: its profiles are deleted, so it is joined with a password again. True when it worked. */
  async forget(saved: SavedNetwork): Promise<boolean> {
    let done: boolean;
    try {
      done = await this.backend.forget(saved.profiles);
    } catch {
      done = false;
    }
    await this.refresh();
    if (done) this.options.networkChanged?.();
    return done;
  }

  /** The failure has been seen (the sheet closed, or the notice was read). */
  dismissFailure(): void {
    if (this.snapshot.join.phase === "failed") this.publish({ join: { phase: "idle" } });
  }

  private publish(change: Partial<WifiState>): void {
    const next = { ...this.snapshot, ...change };
    // Replaced only on a change: useSyncExternalStore re-renders on every new object.
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useWifi(store: WifiStore): WifiState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
