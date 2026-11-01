/**
 * The Network pane's Ethernet and VPN state as a store: read when the pane
 * opens and every few seconds while it is up (a cable plugged in, a VPN
 * finishing its connection), with the VPN being switched shown as it is.
 */

import { useSyncExternalStore } from "react";
import type { NetInfo, NetInfoSource } from "./source.ts";

export interface NetInfoState extends NetInfo {
  /** Null until the first read; false when NetworkManager cannot be asked. */
  available: boolean | null;
  /** The VPNs being brought up or down, by uuid. */
  busy: Readonly<Record<string, "connecting" | "disconnecting">>;
  /** The VPN that would not start or stop, by name. */
  failed: string | null;
}

const INITIAL: NetInfoState = { available: null, ethernet: [], vpns: [], busy: {}, failed: null };

/** How often the state is read while the pane is open. */
export const NETINFO_POLL_MS = 3000;

export class NetInfoStore {
  private snapshot: NetInfoState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private reads = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly source: NetInfoSource,
    private readonly pollMs: number = NETINFO_POLL_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): NetInfoState => this.snapshot;

  open(): void {
    this.timer ??= setInterval(() => void this.refresh(), this.pollMs);
    void this.refresh();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.snapshot.failed !== null) this.publish({ failed: null });
  }

  async refresh(): Promise<void> {
    const read = ++this.reads;
    const info = await this.source.read().catch(() => null);
    if (read !== this.reads) return;
    this.publish(info === null ? { available: false, ethernet: [], vpns: [] } : { available: true, ...info });
  }

  /** Connects or disconnects a VPN. Ignored while that VPN is already changing. */
  async setVpn(uuid: string, up: boolean): Promise<boolean> {
    const vpn = this.snapshot.vpns.find((candidate) => candidate.uuid === uuid);
    if (!vpn || this.snapshot.busy[uuid] !== undefined || vpn.active === up) return false;
    this.publish({ busy: { ...this.snapshot.busy, [uuid]: up ? "connecting" : "disconnecting" }, failed: null });
    const ok = await this.source.setVpn(uuid, up).catch(() => false);
    if (up && ok) await this.settle(uuid);
    await this.refresh();
    const { [uuid]: _done, ...rest } = this.snapshot.busy;
    this.publish({ busy: rest, ...(ok ? {} : { failed: vpn.name }) });
    return ok;
  }

  /** A VPN that is starting takes a moment to be active: wait for it, a few seconds at most. */
  private async settle(uuid: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      await this.refresh();
      if (this.snapshot.vpns.find((vpn) => vpn.uuid === uuid)?.active) return;
      await Bun.sleep(Math.min(this.pollMs, 500));
    }
  }

  private publish(change: Partial<NetInfoState>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useNetInfo(store: NetInfoStore): NetInfoState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
