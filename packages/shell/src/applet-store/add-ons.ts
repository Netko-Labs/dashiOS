/**
 * Dashi's add-ons, from the shell (store-v2 slice 1): every applet catalog
 * merged as the Store merges them, what is installed, and two things the
 * Store window doesn't do while it is closed. Updates that ask for nothing
 * new install by themselves (D327: the new version is from the same catalog,
 * signed by the same author key, which the installer checks, and asks for no
 * permission the person hasn't already allowed); one that asks for more
 * waits in the Store's Updates. And the launcher's Store installs an add-on
 * without leaving the launcher (launcher-store.ts).
 */

import { appletDataRoot, appletsRoot, consentNames, type InstalledApplet, SDK_VERSION } from "@dashi/applet";
import {
  AppletInstaller,
  CatalogSet,
  DASHI_INDEX_KEY,
  dashiCatalog,
  keyFrom,
  mergeCatalogs,
  readSavedCatalogs,
  type StoreApplet,
  statusOf,
  storeCacheDir,
} from "../shared/applet-store/index.ts";
import { settingsPath } from "../shared/settings/index.ts";

export interface AddOnsState {
  /** Every add-on in the catalogs, merged; null before the first look. */
  entries: StoreApplet[] | null;
  installed: InstalledApplet[];
  /** An install the launcher started, by id. */
  installing: string | null;
}

type Installer = Pick<AppletInstaller, "scan" | "install">;
type Catalogs = Pick<CatalogSet, "loadAll" | "dashiUrl">;

export class AddOns {
  private state: AddOnsState = { entries: null, installed: [], installing: null };
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly catalogs: Catalogs,
    private readonly installer: Installer,
    private readonly dashiVersion: string = SDK_VERSION,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AddOnsState => this.state;

  private set(patch: Partial<AddOnsState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Reads the catalogs (their last good copy offline) and the applets folder. */
  async refresh(): Promise<void> {
    const loads = await this.catalogs.loadAll();
    const { applets: installed } = this.installer.scan();
    this.set({ entries: mergeCatalogs(loads, installed, this.catalogs.dashiUrl), installed });
  }

  status(entry: StoreApplet): ReturnType<typeof statusOf> {
    return statusOf(entry, this.state.installed, this.dashiVersion, this.catalogs.dashiUrl);
  }

  /** Whether `entry` asks for a permission its installed version wasn't given (or isn't installed: everything is new). */
  asksForMore(entry: StoreApplet): boolean {
    const had = new Set(this.state.installed.find((each) => each.manifest.id === entry.manifest.id)?.record.consent ?? []);
    return consentNames(entry.manifest).some((name) => !had.has(name));
  }

  /** The updates that install by themselves: newer, and asking for nothing new. */
  quietUpdates(): StoreApplet[] {
    return (this.state.entries ?? []).filter((entry) => this.status(entry).kind === "update" && !this.asksForMore(entry));
  }

  /** Installs (or updates) one; the person allowed exactly what its manifest asks. */
  async install(entry: StoreApplet): Promise<string | null> {
    this.set({ installing: entry.manifest.id });
    try {
      await this.installer.install(entry, consentNames(entry.manifest));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      const { applets: installed } = this.installer.scan();
      this.set({ installing: null, installed });
    }
  }

  /** Looks, then installs each quiet update in turn; the ids it updated. */
  async autoUpdate(): Promise<string[]> {
    await this.refresh();
    const done: string[] = [];
    for (const entry of this.quietUpdates()) if ((await this.install(entry)) === null) done.push(entry.manifest.id);
    return done;
  }
}

/** The shell's add-ons over the person's catalogs (Dashi's, and the ones they added in the Store). */
export function addOnsFor(env: Readonly<Record<string, string | undefined>> = process.env): AddOns {
  const dashi = dashiCatalog(env, keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY);
  const path = settingsPath(env);
  const set = new CatalogSet({
    dashi,
    cacheDir: storeCacheDir(env),
    saved: { read: () => readSavedCatalogs(path, dashi.url).catalogs, write: () => "the launcher's Store saves no catalogs" },
  });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    dashiCatalog: dashi.url,
    download: (url, size, catalog) => set.download(url, size, catalog),
  });
  return new AddOns(set, installer);
}

const FIRST_MS = 4 * 60_000;
const EVERY_MS = 24 * 60 * 60_000;

/** A few minutes after login, then daily: quiet updates install by themselves. Returns what stops it. */
export function watchQuietUpdates(addOns: Pick<AddOns, "autoUpdate">): () => void {
  const look = (): void => {
    void addOns
      .autoUpdate()
      .then((ids) => ids.length > 0 && console.error(`dashi-shell: add-ons updated by themselves: ${ids.join(", ")}`))
      .catch(() => {});
  };
  const first = setTimeout(look, FIRST_MS);
  const daily = setInterval(look, EVERY_MS);
  first.unref?.();
  daily.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
