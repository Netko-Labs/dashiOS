/**
 * The Battery & Power pane's state as a store: the battery (level, state,
 * health), the power mode, and the lid's policy, read when the pane opens and
 * every few seconds while it is up. Choosing a power mode shows at once and is
 * read back, so what the pane shows is what the daemon has.
 */

import { useSyncExternalStore } from "react";
import type { LidPolicy, LidSource } from "../power/policy.ts";
import type { BatteryDetails } from "./battery-details.ts";
import type { ProfileId, Profiles, ProfileSource } from "./profiles.ts";

export interface EnergySources {
  battery(): Promise<BatteryDetails | null>;
  profiles: ProfileSource;
  lid: LidSource;
}

export interface EnergyState {
  /** False until the first read has finished. */
  loaded: boolean;
  /** Null on a machine with no battery. */
  battery: BatteryDetails | null;
  /** Null without power-profiles-daemon. */
  profiles: Profiles | null;
  /** Null when logind cannot be asked. */
  lid: LidPolicy | null;
  /** The mode that would not be set. */
  failed: ProfileId | null;
}

const INITIAL: EnergyState = { loaded: false, battery: null, profiles: null, lid: null, failed: null };

export const ENERGY_POLL_MS = 5000;

export class EnergyStore {
  private snapshot: EnergyState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private reads = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The mode being set: reads wait for it, so a poll cannot flip the choice back. */
  private setting = false;
  /** The lid policy is the system's configuration: read once, not polled. */
  private lidRead = false;

  constructor(
    private readonly sources: EnergySources,
    private readonly pollMs: number = ENERGY_POLL_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EnergyState => this.snapshot;

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
    if (this.setting) return;
    const read = ++this.reads;
    const wantLid = !this.lidRead;
    this.lidRead = true;
    const [battery, profiles, lid] = await Promise.all([
      this.sources.battery().catch(() => null),
      this.sources.profiles.read().catch(() => null),
      wantLid ? this.sources.lid.read().catch(() => null) : Promise.resolve(this.snapshot.lid),
    ]);
    if (read !== this.reads || this.setting) {
      // A read that lost the race still found the lid out.
      if (wantLid) this.publish({ lid });
      return;
    }
    this.publish({ loaded: true, battery, profiles, lid });
  }

  /** Switches the power mode. A mode the machine does not offer is ignored. */
  async setProfile(id: ProfileId): Promise<boolean> {
    const { profiles } = this.snapshot;
    if (!profiles || !profiles.available.includes(id) || this.setting) return false;
    if (profiles.active === id) return true;
    this.setting = true;
    this.reads++;
    this.publish({ profiles: { ...profiles, active: id }, failed: null });
    const ok = await this.sources.profiles.set(id).catch(() => false);
    this.setting = false;
    if (!ok) this.publish({ failed: id });
    await this.refresh();
    return ok;
  }

  private publish(change: Partial<EnergyState>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export function useEnergy(store: EnergyStore): EnergyState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
