/**
 * Menu bar applets, in Software: every catalog (Dashi's, checked against
 * Dashi's key, and the ones the person added, each against its own),
 * merged into one list, what is installed, this machine, and getting,
 * updating, turning off, and removing them. Installs and removals run on
 * Software's one queue (the toolbar's activity says so); a failure is
 * Software's failure sheet. Every change starts from a click, and one that
 * adds permissions waits for the consent sheet. Without a key for Dashi's
 * catalog (src/shared/applet-store/keys.ts) and no catalog added, nothing is
 * listed: Installed still lists what was added by hand. An applet a catalog
 * lists that this Dashi can't read is left out and counted (`skipped`); one
 * installed whose files no longer read is `unreadable`: listed, never run,
 * mended by an update from its own catalog or removed.
 */

import { consentNames, fits, type InstalledApplet, type Machine, type UnreadableApplet, writeRecord } from "@dashi/applet";
import type { CatalogSet } from "../../../src/shared/applet-store/catalog-set.ts";
import type { CatalogDraft, CatalogSource } from "../../../src/shared/applet-store/catalogs.ts";
import { type AppletInstaller, type AppletStatus, statusOf } from "../../../src/shared/applet-store/installer.ts";
import { type CatalogLoad, entryFromItsCatalog, mergeCatalogs, type StoreApplet, skippedCount } from "../../../src/shared/applet-store/merge.ts";
import type { Outcome } from "../../../src/shared/software/manager.ts";
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
  /** Installed, but no longer readable: they don't run, and need an update. */
  unreadable: UnreadableApplet[];
  /** How many applets the catalogs list that this Dashi can't read (left out of `index`). */
  skipped: number;
  machine: Machine | null;
  /** Applets the kill switch just turned off, to say so once. */
  justPulled: string[];
}

const EMPTY: AppletState = {
  index: null,
  catalogs: [],
  stale: false,
  loading: true,
  problem: null,
  installed: [],
  unreadable: [],
  skipped: 0,
  machine: null,
  justPulled: [],
};

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
    private readonly installer: Pick<AppletInstaller, "scan" | "install" | "remove" | "disablePulled" | "catalogOf">,
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
    const { applets, unreadable } = this.installer.scan();
    this.set({ installed: applets, unreadable });
  }

  /** Loads every catalog (and applies each one's kill switch to what came from it), what is installed, and this machine. */
  async refresh(): Promise<void> {
    this.set({ loading: true });
    this.readInstalled();
    // A machine that can't be read stays unknown (null): fitsHere says so.
    void this.machine()
      .then((machine) => this.set({ machine }))
      .catch(() => undefined);
    const loads = await this.catalogs.loadAll();
    const justPulled = loads.flatMap((load) => (load.index ? this.installer.disablePulled(load.index, load.source.url) : []));
    const { applets: installed, unreadable } = this.installer.scan();
    const loaded = loads.filter((load) => load.index !== null);
    if (loaded.length === 0) {
      // Nothing to list: the first catalog that could have been read says why (Dashi's first); none at all is "no key".
      const kind = loads.find((load) => load.problem !== null && load.problem !== "no-key")?.problem ?? "no-key";
      return this.set({
        index: null,
        catalogs: loads,
        stale: false,
        loading: false,
        problem: { kind, message: "" },
        installed,
        unreadable,
        skipped: 0,
        justPulled,
      });
    }
    const applets = mergeCatalogs(loads, installed, this.catalogs.dashiUrl);
    this.set({
      index: { applets },
      skipped: skippedCount(loads, applets),
      catalogs: loads,
      stale: loaded.some((load) => load.stale),
      loading: false,
      problem: null,
      installed,
      unreadable,
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

  /** Where an installed applet came from (one whose record doesn't read is from nowhere this store knows: by hand). */
  originOf(applet: { record: InstalledApplet["record"] | null }): AppletOrigin {
    if (applet.record === null) return { kind: "local" };
    const url = this.installer.catalogOf({ record: applet.record });
    if (url === null) return { kind: "local" };
    const source = this.sources().find((each) => each.url === url);
    return source ? { kind: "catalog", source } : { kind: "removed" };
  }

  /** What the store shows for `id`: an installed one from its own catalog (undefined when that is gone or dropped it), else the list's. */
  entry(id: string): StoreApplet | undefined {
    const record = this.state.installed.find((each) => each.manifest.id === id)?.record ?? this.state.unreadable.find((each) => each.id === id)?.record;
    if (record && this.installer.catalogOf({ record }) !== null)
      return entryFromItsCatalog(this.state.catalogs, { manifest: { id }, record }, this.catalogs.dashiUrl);
    return this.state.index?.applets.find((each) => each.manifest.id === id);
  }

  status(entry: StoreApplet): AppletStatus {
    return statusOf(entry, this.state.installed, this.dashiVersion, this.catalogs.dashiUrl, this.state.unreadable);
  }

  /** What the person already allowed `id`, by name (an update's sheet lists only what is new). */
  granted(id: string): string[] {
    const record = this.state.installed.find((each) => each.manifest.id === id)?.record ?? this.state.unreadable.find((each) => each.id === id)?.record;
    return record?.consent ?? [];
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
    const update = this.state.installed.some((each) => each.manifest.id === id) || this.state.unreadable.some((each) => each.id === id);
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

  /** Queues removing it (by its id and name: one that no longer reads goes the same way); `withData` deletes what it saved too. */
  remove(applet: { id: string; name: string }, withData = false): void {
    const { id, name } = applet;
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
      return status.kind === "update" || ((status.kind === "pulled" || status.kind === "unreadable") && status.good !== null);
    });
    this.memo = { index, installed, updates };
    return updates;
  }
}
