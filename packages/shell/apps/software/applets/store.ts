/**
 * Menu bar applets, in Software: every catalog (Dashi's, checked against
 * Dashi's key, and the ones the person added, each against its own),
 * merged into one list, what is installed, this machine, and getting,
 * updating, turning off, and removing them. Installs and removals run on
 * Software's one queue (the toolbar's activity says so); a failure is
 * Software's failure sheet. Every change starts from a click, and one that
 * adds permissions waits for the consent sheet. Without a key for Dashi's
 * catalog (src/applet-store/keys.ts) and no catalog added, nothing is
 * listed: Installed still lists what was added by hand.
 */

import { consentNames, fits, type InstalledApplet, type Machine, writeRecord } from "@dashi/applet";
import type { CatalogSet } from "../../../src/applet-store/catalog-set.ts";
import type { CatalogDraft, CatalogSource } from "../../../src/applet-store/catalogs.ts";
import { type AppletInstaller, type AppletStatus, statusOf } from "../../../src/applet-store/installer.ts";
import { type CatalogLoad, entryFromItsCatalog, mergeCatalogs, type StoreApplet } from "../../../src/applet-store/merge.ts";
import type { Outcome } from "../../../src/software/manager.ts";
import type { Job } from "../queue.ts";
import { type Failure, failureOf } from "../store.ts";

export type AppletProblem = "offline" | "unsigned" | "invalid" | "no-key" | "other";

export interface AppletState {
  /** Every catalog's applets, merged (merge.ts); null while none has loaded. */
  index: { applets: StoreApplet[] } | null;
  /** Each catalog as it loaded, Dashi's first (the Catalogs sheet). */
  catalogs: CatalogLoad[];
  /** A catalog came from its last good copy. */
  stale: boolean;
  loading: boolean;
  /** Why nothing is listed: offline, not signed, or no catalog to read. */
  problem: { kind: AppletProblem; message: string } | null;
  installed: InstalledApplet[];
  machine: Machine | null;
  /** Applets the kill switch just turned off, to say so once. */
  justPulled: string[];
}

const EMPTY: AppletState = { index: null, catalogs: [], stale: false, loading: true, problem: null, installed: [], machine: null, justPulled: [] };

/** Where an installed applet came from: by hand, a catalog in the list, or one since removed. */
export type AppletOrigin = { kind: "local" } | { kind: "catalog"; source: CatalogSource } | { kind: "removed" };

/** Software's queue and failure sheet, as the applets use them. */
export interface AppletJobs {
  enqueue(job: Job): boolean;
  fail(failure: Failure): void;
}

export class AppletStore {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();
  private memo: { index: AppletState["index"]; installed: InstalledApplet[]; updates: StoreApplet[] } | null = null;

  constructor(
    private readonly catalogs: Pick<CatalogSet, "dashiUrl" | "sources" | "loadAll" | "add" | "remove">,
    private readonly installer: Pick<AppletInstaller, "installed" | "install" | "remove" | "disablePulled" | "catalogOf">,
    private readonly machine: () => Promise<Machine>,
    readonly dashiVersion: string,
    private readonly jobs: AppletJobs,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AppletState => this.state;

  /** Every catalog in the list, Dashi's first. */
  sources(): CatalogSource[] {
    return this.catalogs.sources();
  }

  private set(change: Partial<AppletState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads the applets folder again (after a change, or a look). */
  readInstalled(): void {
    this.set({ installed: this.installer.installed() });
  }

  /** Loads every catalog (and applies each one's kill switch to what came from it), what is installed, and this machine. */
  async refresh(): Promise<void> {
    this.set({ loading: true, installed: this.installer.installed() });
    // A machine that can't be read stays unknown (null): fitsHere says so.
    void this.machine()
      .then((machine) => this.set({ machine }))
      .catch(() => undefined);
    const loads = await this.catalogs.loadAll();
    const justPulled = loads.flatMap((load) => (load.index ? this.installer.disablePulled(load.index, load.source.url) : []));
    const installed = this.installer.installed();
    const loaded = loads.filter((load) => load.index !== null);
    if (loaded.length === 0) {
      // Nothing to list: the first catalog that could have been read says why (Dashi's first); none at all is "no key".
      const kind = loads.find((load) => load.problem !== null && load.problem !== "no-key")?.problem ?? "no-key";
      return this.set({ index: null, catalogs: loads, stale: false, loading: false, problem: { kind, message: "" }, installed, justPulled });
    }
    this.set({
      index: { applets: mergeCatalogs(loads, installed, this.catalogs.dashiUrl) },
      catalogs: loads,
      stale: loaded.some((load) => load.stale),
      loading: false,
      problem: null,
      installed,
      justPulled,
    });
  }

  /** Adds a catalog once its index checks with the key given (then lists it); why not, in people's words, or null. */
  async addCatalog(draft: CatalogDraft): Promise<string | null> {
    const failed = await this.catalogs.add(draft);
    if (failed === null) await this.refresh();
    return failed;
  }

  /** Removes an added catalog; its applets stay installed, and get no updates. Why not, in words, or null. */
  removeCatalog(url: string): string | null {
    const failed = this.catalogs.remove(url);
    if (failed === null) void this.refresh();
    return failed;
  }

  /** Where an installed applet came from. */
  originOf(applet: Pick<InstalledApplet, "record">): AppletOrigin {
    const url = this.installer.catalogOf(applet);
    if (url === null) return { kind: "local" };
    const source = this.sources().find((each) => each.url === url);
    return source ? { kind: "catalog", source } : { kind: "removed" };
  }

  /** What the store shows for `id`: an installed one from its own catalog (undefined when that is gone or dropped it), else the list's. */
  entry(id: string): StoreApplet | undefined {
    const mine = this.state.installed.find((each) => each.manifest.id === id);
    if (mine && this.installer.catalogOf(mine) !== null) return entryFromItsCatalog(this.state.catalogs, mine, this.catalogs.dashiUrl);
    return this.state.index?.applets.find((each) => each.manifest.id === id);
  }

  status(entry: StoreApplet): AppletStatus {
    return statusOf(entry, this.state.installed, this.dashiVersion, this.catalogs.dashiUrl);
  }

  /** What the person already allowed `id`, by name (an update's sheet lists only what is new). */
  granted(id: string): string[] {
    return this.state.installed.find((each) => each.manifest.id === id)?.record.consent ?? [];
  }

  /** Whether getting (or updating to) `entry` needs the consent sheet: it asks for something not yet allowed. */
  needsConsent(entry: StoreApplet): boolean {
    const had = new Set(this.granted(entry.manifest.id));
    return consentNames(entry.manifest).some((name) => !had.has(name));
  }

  /** Whether this machine is one `entry` says it is for (unknown until the machine is read). */
  fitsHere(entry: StoreApplet): boolean | null {
    return this.state.machine === null ? null : fits(entry.manifest.when, this.state.machine);
  }

  /** Queues getting (or updating to) the newest good version; what the sheet listed is what is allowed. */
  install(entry: StoreApplet): void {
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
  updates(): StoreApplet[] {
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
