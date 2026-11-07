/**
 * What the window talks to, made once: Flathub's catalog and its images, the
 * store of installed apps, updates and the one queue of changes, and the
 * menu bar applets (their catalog, checked with Dashi's key, the installer,
 * their images). `DASHI_APPLETS_INDEX` and `DASHI_APPLETS_KEY` point the
 * applets at another catalog (a test one).
 */

import { appletDataRoot, appletsRoot, SDK_VERSION } from "@dashi/applet";
import { createContext, useContext } from "react";
import { Catalog, DEFAULT_INDEX, keyFrom, storeCacheDir } from "../../src/applet-store/catalog.ts";
import { StoreImages } from "../../src/applet-store/images.ts";
import { AppletInstaller } from "../../src/applet-store/installer.ts";
import { DASHI_INDEX_KEY } from "../../src/applet-store/keys.ts";
import { readMachine } from "../../src/applet-store/machine.ts";
import { spawnDetached } from "../../src/menus/launch.ts";
import { ImageCache, JsonCache } from "../../src/software/cache.ts";
import { Flathub } from "../../src/software/flathub.ts";
import { Images } from "../../src/software/images.ts";
import { Software } from "../../src/software/manager.ts";
import { displayUrl } from "../../src/software/parse-values.ts";
import { cacheRoot } from "../../src/software/paths.ts";
import { standIn } from "../../src/software/stand-in.ts";
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
  const appletCatalog = new Catalog({
    url: env.DASHI_APPLETS_INDEX ?? DEFAULT_INDEX,
    key: keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY,
    cacheDir: appletCache,
  });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    download: (url, size) => appletCatalog.download(url, size),
  });
  return {
    catalog: new Flathub({ cache: new JsonCache(root) }),
    images: new Images(new ImageCache(root)),
    store,
    applets: new AppletStore(appletCatalog, installer, () => readMachine(), SDK_VERSION, store),
    appletImages: new StoreImages(`${appletCache}/images`),
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
