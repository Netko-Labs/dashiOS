/**
 * The apps' permissions for Settings › Privacy & Security: what the portal's
 * permission store holds (permission-store.ts), each grant with since when
 * (seen.ts), read again whenever the store says it changed. The shell runs
 * one from login, so a grant is dated when it is given, not when Settings
 * next opens.
 */

import type { PermissionStore } from "./lib/permission-store.ts";
import type { SeenTimes } from "./lib/seen.ts";
import { grantKey, type PortalGrant } from "./portal-grants.ts";

/** A grant with its date: since when, in seconds, or null when it isn't known. */
export interface AppGrant extends PortalGrant {
  since: number | null;
}

export type AppGrants =
  | { state: "loading" }
  /** No permission store on this computer (or it can't be reached): nothing to list. */
  | { state: "unavailable" }
  | { state: "ready"; grants: readonly AppGrant[] };

export class PrivacyStore {
  private snapshot: AppGrants = { state: "loading" };
  private readonly listeners = new Set<() => void>();
  private reading: Promise<void> | null = null;
  private again = false;
  private stopWatch: (() => void) | null = null;

  constructor(
    private readonly store: Pick<PermissionStore, "list" | "revoke" | "watch">,
    private readonly seen: Pick<SeenTimes, "since" | "update">,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppGrants => this.snapshot;

  /** Read the grants now and follow the store's changes; returns what stops it. */
  start(): () => void {
    let stopped = false;
    void this.refresh();
    void this.store
      .watch(() => void this.refresh())
      .then((stop) => {
        // Stopped while the bus was still subscribing: the watch ends as it starts.
        if (stopped) stop();
        else this.stopWatch = stop;
      })
      .catch(() => {
        // No store to hear: refresh() said so already.
      });
    return () => {
      stopped = true;
      this.stopWatch?.();
      this.stopWatch = null;
    };
  }

  /** Read the store again; a read asked for while one runs runs once more after it. */
  refresh(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = this.read().finally(() => {
      this.reading = null;
      if (this.again) {
        this.again = false;
        void this.refresh();
      }
    });
    return this.reading;
  }

  private async read(): Promise<void> {
    try {
      const grants = await this.store.list();
      this.seen.update(grants.map(grantKey));
      this.set({ state: "ready", grants: grants.map((grant) => ({ ...grant, since: this.seen.since(grantKey(grant)) })) });
    } catch {
      this.set({ state: "unavailable" });
    }
  }

  /** Take one grant back; the list is read again either way. */
  async revoke(grant: Pick<PortalGrant, "table" | "id" | "app">): Promise<void> {
    try {
      await this.store.revoke(grant);
    } finally {
      await this.refresh();
    }
  }

  private set(next: AppGrants): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
