/**
 * What the window talks to, made once: Flathub's catalog and its images, the
 * store of installed apps, updates and the one queue of changes, and the
 * menu bar applets (their catalogs: Dashi's, checked with Dashi's key, and
 * the ones the person added in the settings file, each with its own; the
 * installer, their images). `DASHI_APPLETS_INDEX` and `DASHI_APPLETS_KEY`
 * point Dashi's at another catalog (a test one).
 */

import { appletDataRoot, appletsRoot, SDK_VERSION } from "@dashi/applet";
import { createContext, useContext } from "react";
import {
  AppletInstaller,
  CatalogSet,
  DASHI_INDEX_KEY,
  dashiCatalog,
  hostsFor,
  keyFrom,
  readMachine,
  readSavedCatalogs,
  StoreImages,
  storeCacheDir,
  writeSavedCatalogs,
} from "../../../src/shared/applet-store/index.ts";
import { spawnDetached, unlistedDesktopIds } from "../../../src/shared/apps/index.ts";
import { settingsPath } from "../../../src/shared/settings/index.ts";
import { Catalog, cacheRoot, displayUrl, Flathub, ImageCache, Images, JsonCache, Packages, Software, standIn } from "../../../src/shared/software/index.ts";
import { followFolder } from "./applets/follow.ts";
import { AppletStore } from "./applets/store.ts";
import { SoftwareStore } from "./store.ts";

export interface Services {
  /** Flathub's live answers: an app's page, its pictures, Discover's rows. */
  catalog: Flathub;
  /** The catalog on this computer: every source, searched offline (D320). */
  index: Catalog;
  /** Packages and sources: PackageKit and flatpak's remotes (D322). */
  packages: Packages;
  images: Images;
  store: SoftwareStore;
  applets: AppletStore;
  appletImages: StoreImages;
  /** Restarts the machine, after the person asked (the shell's own path, refused outside a real session). */
  restart(): void;
  /** Logs out, after the person asked (to finish Dashi's own update). */
  logOut(): void;
  /** Opens an https address in the browser (an app's website, an applet's source). */
  openUrl(url: string): void;
  /** Calls `onChange` when the applets folder changes from anywhere (the launcher's Get, `dashi-applet`); returns what stops it. */
  followApplets(onChange: () => void): () => void;
  /** The desktop ids that are no app to open (a library's helper, NoDisplay): Installed leaves their packages out. */
  unlistedApps(): ReadonlySet<string>;
}

/** Hands an https address to the desktop's browser; anything else is ignored. */
export function openInBrowser(url: string, launch: (command: readonly string[]) => void = spawnDetached): void {
  const checked = displayUrl(url);
  if (checked) launch(["gio", "open", checked]);
}

export function createServices(restart: () => void, logOut: () => void, env: Readonly<Record<string, string | undefined>> = process.env): Services {
  const root = cacheRoot();
  const fake = standIn();
  const software = new Software(fake ?? {});
  const store = new SoftwareStore(software);
  const packages = new Packages(fake?.run ? { run: fake.run } : {});
  const installedFlatpaks = async (): Promise<string[]> => (software.hasFlatpak ? (await software.installed()).map((app) => app.id) : []);
  const appletCache = storeCacheDir(env);
  const dashi = dashiCatalog(env, keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY);
  const path = settingsPath(env);
  // The added catalogs are read from the file each time, and written as the settings store writes (read-modify-write, atomic); no change-log entry.
  const appletCatalogs = new CatalogSet({
    dashi,
    cacheDir: appletCache,
    saved: {
      read: () => readSavedCatalogs(path, dashi.url).catalogs,
      write: (catalogs) => writeSavedCatalogs(path, catalogs),
    },
  });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    dashiCatalog: dashi.url,
    download: (url, size, catalog) => appletCatalogs.download(url, size, catalog),
  });
  return {
    catalog: new Flathub({ cache: new JsonCache(root) }),
    index: new Catalog({
      root,
      installedFlatpaks,
      refreshMetadata: () => packages.refresh(),
      ...(fake?.run ? { run: fake.run, fetch: () => Promise.reject(new Error("stand-in")) } : {}),
    }),
    packages,
    images: new Images(new ImageCache(root)),
    store,
    applets: new AppletStore(appletCatalogs, installer, () => readMachine(), SDK_VERSION, store),
    appletImages: new StoreImages(`${appletCache}/images`, undefined, () => [...new Set(appletCatalogs.sources().flatMap((source) => hostsFor(source.url)))]),
    restart,
    logOut,
    openUrl: (url) => openInBrowser(url),
    followApplets: (onChange) => followFolder(appletsRoot(), onChange),
    unlistedApps: () => unlistedDesktopIds(),
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("Software's services are not provided");
  return services;
}
