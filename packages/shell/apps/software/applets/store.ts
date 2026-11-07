/**
 * Menu bar applets, in Software: the catalog (checked against Dashi's key),
 * what is installed, this machine, and getting, updating, turning off, and
 * removing them. Installs and removals run on Software's one queue (the
 * toolbar's activity says so); a failure is Software's failure sheet. Every
 * change starts from a click, and one that adds permissions waits for the
 * consent sheet. Without a key for the catalog (src/applet-store/keys.ts)
 * nothing from it is shown: Installed still lists what was added by hand.
 */

import { type CatalogIndex, consentNames, fits, type IndexApplet, type InstalledApplet, type Machine, writeRecord } from "@dashi/applet";
import { type Catalog, CatalogError } from "../../../src/applet-store/catalog.ts";
import { type AppletInstaller, type AppletStatus, statusOf } from "../../../src/applet-store/installer.ts";
import type { Outcome } from "../../../src/software/manager.ts";
import type { Job } from "../queue.ts";
import { type Failure, failureOf } from "../store.ts";

export interface AppletState {
  index: CatalogIndex | null;
  /** The catalog came from the last good copy. */
  stale: boolean;
  loading: boolean;
  /** Why there is no catalog: offline, not signed, or no key in this build. */
  problem: { kind: "offline" | "unsigned" | "no-key" | "other"; message: string } | null;
  installed: InstalledApplet[];
  machine: Machine | null;
  /** Applets the kill switch just turned off, to say so once. */
  justPulled: string[];
}

const EMPTY: AppletState = { index: null, stale: false, loading: true, problem: null, installed: [], machine: null, justPulled: [] };

/** Software's queue and failure sheet, as the applets use them. */
export interface AppletJobs {
  enqueue(job: Job): boolean;
  fail(failure: Failure): void;
}

export class AppletStore {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();
  private memo: { index: CatalogIndex | null; installed: InstalledApplet[]; updates: IndexApplet[] } | null = null;

  constructor(
    private readonly catalog: Pick<Catalog, "hasKey" | "load">,
    private readonly installer: Pick<AppletInstaller, "installed" | "install" | "remove" | "disablePulled">,
    private readonly machine: () => Promise<Machine>,
    readonly dashiVersion: string,
    private readonly jobs: AppletJobs,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppletState => this.state;

  /** Whether the catalog can be shown at all: false while this build has no key for it. */
  get catalogReady(): boolean {
    return this.catalog.hasKey;
  }

  private set(change: Partial<AppletState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads the applets folder again (after a change, or a look). */
  readInstalled(): void {
    this.set({ installed: this.installer.installed() });
  }

  /** Loads the catalog (and applies its kill switch), what is installed, and this machine. */
  async refresh(): Promise<void> {
    this.set({ loading: true, installed: this.installer.installed() });
    // A machine that can't be read stays unknown (null): fitsHere says so.
    void this.machine()
      .then((machine) => this.set({ machine }))
      .catch(() => undefined);
    if (!this.catalog.hasKey) return this.set({ loading: false, problem: { kind: "no-key", message: "" } });
    try {
      const { index, stale } = await this.catalog.load();
      const justPulled = this.installer.disablePulled(index);
      this.set({ index, stale, loading: false, problem: null, installed: this.installer.installed(), justPulled });
    } catch (error) {
      const kind = error instanceof CatalogError ? error.kind : "other";
      this.set({ loading: false, problem: { kind, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  entry(id: string): IndexApplet | undefined {
    return this.state.index?.applets.find((each) => each.manifest.id === id);
  }

  status(entry: IndexApplet): AppletStatus {
    return statusOf(entry, this.state.installed, this.dashiVersion);
  }

  /** What the person already allowed `id`, by name (an update's sheet lists only what is new). */
  granted(id: string): string[] {
    return this.state.installed.find((each) => each.manifest.id === id)?.record.consent ?? [];
  }

  /** Whether getting (or updating to) `entry` needs the consent sheet: it asks for something not yet allowed. */
  needsConsent(entry: IndexApplet): boolean {
    const had = new Set(this.granted(entry.manifest.id));
    return consentNames(entry.manifest).some((name) => !had.has(name));
  }

  /** Whether this machine is one `entry` says it is for (unknown until the machine is read). */
  fitsHere(entry: IndexApplet): boolean | null {
    return this.state.machine === null ? null : fits(entry.manifest.when, this.state.machine);
  }

  /** Queues getting (or updating to) the newest good version; what the sheet listed is what is allowed. */
  install(entry: IndexApplet): void {
    const { id, name } = entry.manifest;
    const update = this.state.installed.some((each) => each.manifest.id === id);
    this.jobs.enqueue({
      operation: { key: `applet:install:${id}`, kind: update ? "update" : "install", id, subject: "applet", name },
      start: async (report): Promise<Outcome> => {
        report({ fraction: null, label: "Checking its signature" });
        try {
          await this.installer.install(entry, consentNames(entry.manifest));
          return { ok: true, message: "" };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      },
      done: () => this.readInstalled(),
    });
  }

  /** Queues removing it; `withData` deletes what it saved too. */
  remove(applet: InstalledApplet, withData = false): void {
    const { id, name } = applet.manifest;
    this.jobs.enqueue({
      operation: { key: `applet:remove:${id}`, kind: "remove", id, subject: "applet", name },
      start: async (): Promise<Outcome> => {
        try {
          this.installer.remove(id, withData);
          return { ok: true, message: "" };
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      },
      done: () => this.readInstalled(),
    });
  }

  /** Turns an installed applet off (it leaves the menu bar; the shell stops it) or on again. A pulled one stays off. */
  setOn(applet: InstalledApplet, on: boolean): void {
    if (applet.record.disabled?.reason === "pulled") return;
    const { disabled: _off, ...rest } = applet.record;
    try {
      writeRecord(applet.dir, on ? rest : { ...rest, disabled: { reason: "off" } });
    } catch (error) {
      this.jobs.fail(failureOf({ kind: "update", id: applet.manifest.id, name: applet.manifest.name }, error instanceof Error ? error.message : String(error)));
    }
    this.readInstalled();
  }

  dismissPulled(): void {
    this.set({ justPulled: [] });
  }

  /** Every applet with an update (pulled ones with a good version too); worked out once per catalog and folder. */
  updates(): IndexApplet[] {
    const { index, installed } = this.state;
    if (this.memo?.index === index && this.memo.installed === installed) return this.memo.updates;
    const updates = (index?.applets ?? []).filter((entry) => {
      const status = this.status(entry);
      return status.kind === "update" || (status.kind === "pulled" && status.good !== null);
    });
    this.memo = { index, installed, updates };
    return updates;
  }
}
