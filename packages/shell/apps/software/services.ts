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
import { SettingsStore } from "../../src/settings-app/store.ts";
import { hostsFor, keyFrom, storeCacheDir } from "../../src/shared/applet-store/catalog.ts";
import { CatalogSet, readSavedCatalogs } from "../../src/shared/applet-store/catalog-set.ts";
import { dashiCatalog } from "../../src/shared/applet-store/catalogs.ts";
import { StoreImages } from "../../src/shared/applet-store/images.ts";
import { AppletInstaller } from "../../src/shared/applet-store/installer.ts";
import { DASHI_INDEX_KEY } from "../../src/shared/applet-store/keys.ts";
import { readMachine } from "../../src/shared/applet-store/machine.ts";
import { spawnDetached } from "../../src/shared/apps/index.ts";
import { settingsPath } from "../../src/shared/settings/file.ts";
import { ImageCache, JsonCache } from "../../src/shared/software/cache.ts";
import { Flathub } from "../../src/shared/software/flathub.ts";
import { Images } from "../../src/shared/software/images.ts";
import { Software } from "../../src/shared/software/manager.ts";
import { displayUrl } from "../../src/shared/software/parse-values.ts";
import { cacheRoot } from "../../src/shared/software/paths.ts";
import { standIn } from "../../src/shared/software/stand-in.ts";
import { AppletStore } from "./applets/store.ts";
import { SoftwareStore } from "./store.ts";

export interface Services {
  catalog: Flathub;
  images: Images;
  store: SoftwareStore;
  applets: AppletStore;
  appletImages: StoreImages;
  /** Restarts the machine, after the person asked (the shell's own path, refused outside a real session). */
  restart(): void;
  /** Opens an https address in the browser (an app's website, an applet's source). */
  openUrl(url: string): void;
}

/** Hands an https address to the desktop's browser; anything else is ignored. */
export function openInBrowser(url: string, launch: (command: readonly string[]) => void = spawnDetached): void {
  const checked = displayUrl(url);
  if (checked) launch(["gio", "open", checked]);
}

export function createServices(restart: () => void, env: Readonly<Record<string, string | undefined>> = process.env): Services {
  const root = cacheRoot();
  const store = new SoftwareStore(new Software(standIn() ?? {}));
  const appletCache = storeCacheDir(env);
  const dashi = dashiCatalog(env, keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY);
  const path = settingsPath(env);
  // The added catalogs are read from the file each time, and written through the settings store (read-modify-write, atomic); no change-log entry.
  const settings = new SettingsStore(path, null);
  const appletCatalogs = new CatalogSet({
    dashi,
    cacheDir: appletCache,
    saved: {
      read: () => readSavedCatalogs(path, dashi.url).catalogs,
      write: (catalogs) => {
        settings.patch("applets", { catalogs: catalogs.length > 0 ? [...catalogs] : undefined });
        return settings.getSnapshot().error;
      },
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
    images: new Images(new ImageCache(root)),
    store,
    applets: new AppletStore(appletCatalogs, installer, () => readMachine(), SDK_VERSION, store),
    appletImages: new StoreImages(`${appletCache}/images`, undefined, () => [...new Set(appletCatalogs.sources().flatMap((source) => hostsFor(source.url)))]),
    restart,
    openUrl: (url) => openInBrowser(url),
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("Software's services are not provided");
  return services;
}
