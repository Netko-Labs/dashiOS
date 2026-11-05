/**
 * The Applet Store's state: the catalog (checked), what is installed, this
 * machine, and what is being done. One store, made once; the views read it
 * with useSyncExternalStore. Every install and removal starts from a click,
 * and an install that adds permissions waits for the consent sheet.
 */

import { type CatalogIndex, fits, type IndexApplet, type InstalledApplet, type Machine, permissionName, widens } from "@dashi/applet";
import { type Catalog, CatalogError } from "../../src/applet-store/catalog.ts";
import { type AppletInstaller, type AppletStatus, statusOf } from "../../src/applet-store/installer.ts";

export interface StoreState {
  index: CatalogIndex | null;
  /** The catalog came from the last good copy. */
  stale: boolean;
  loading: boolean;
  /** Why there is no catalog: offline, not signed, or no key in this build. */
  problem: { kind: "offline" | "unsigned" | "no-key" | "other"; message: string } | null;
  installed: InstalledApplet[];
  machine: Machine | null;
  /** Applet id → what is happening to it. */
  busy: Readonly<Record<string, "installing" | "removing">>;
  /** The last thing that failed, for the sheet. */
  failure: string | null;
  /** Applets the kill switch just turned off, to say so once. */
  justPulled: string[];
}

const EMPTY: StoreState = { index: null, stale: false, loading: true, problem: null, installed: [], machine: null, busy: {}, failure: null, justPulled: [] };

export class AppletStore {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly catalog: Catalog,
    private readonly installer: AppletInstaller,
    private readonly machine: () => Promise<Machine>,
    readonly dashiVersion: string,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StoreState => this.state;

  private set(change: Partial<StoreState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  /** Loads the catalog (and applies its kill switch), what is installed, and this machine. */
  async refresh(): Promise<void> {
    this.set({ loading: true, installed: this.installer.installed() });
    void this.machine().then((machine) => this.set({ machine }));
    try {
      const { index, stale } = await this.catalog.load();
      const justPulled = this.installer.disablePulled(index);
      this.set({ index, stale, loading: false, problem: null, installed: this.installer.installed(), justPulled });
    } catch (error) {
      const kind = error instanceof CatalogError ? error.kind : "other";
      this.set({ loading: false, problem: { kind, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  status(entry: IndexApplet): AppletStatus {
    return statusOf(entry, this.state.installed, this.dashiVersion);
  }

  /** Whether installing (or updating to) `entry` needs the consent sheet: it asks for something not yet allowed. */
  needsConsent(entry: IndexApplet): boolean {
    const mine = this.state.installed.find((each) => each.manifest.id === entry.manifest.id);
    return entry.manifest.permissions.length > 0 && (!mine || widens(mine.record.consent, entry.manifest.permissions));
  }

  /** Whether this machine is one `entry` says it is for (unknown until the machine is read). */
  fitsHere(entry: IndexApplet): boolean | null {
    return this.state.machine === null ? null : fits(entry.manifest.when, this.state.machine);
  }

  async install(entry: IndexApplet): Promise<void> {
    const id = entry.manifest.id;
    if (this.state.busy[id]) return;
    this.set({ busy: { ...this.state.busy, [id]: "installing" } });
    try {
      // The consent sheet came first (needsConsent); what it listed is what is allowed.
      await this.installer.install(entry, entry.manifest.permissions.map(permissionName));
    } catch (error) {
      this.set({ failure: `${entry.manifest.name} wasn't installed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      const { [id]: _done, ...rest } = this.state.busy;
      this.set({ busy: rest, installed: this.installer.installed() });
    }
  }

  remove(id: string): void {
    this.set({ busy: { ...this.state.busy, [id]: "removing" } });
    try {
      this.installer.remove(id);
    } catch (error) {
      this.set({ failure: `It wasn't removed: ${error instanceof Error ? error.message : String(error)}` });
    }
    const { [id]: _done, ...rest } = this.state.busy;
    this.set({ busy: rest, installed: this.installer.installed() });
  }

  dismissFailure(): void {
    this.set({ failure: null, justPulled: [] });
  }

  /** Every applet with an update (pulled ones with a good version too). */
  updates(): IndexApplet[] {
    return (this.state.index?.applets ?? []).filter((entry) => {
      const status = this.status(entry);
      return status.kind === "update" || (status.kind === "pulled" && status.good !== null);
    });
  }
}
