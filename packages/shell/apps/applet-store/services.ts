/**
 * What the Applet Store's window talks to, made once: the catalog (checked
 * with Dashi's key), the installer, the images, and the store of state.
 */

import { appletDataRoot, appletsRoot, SDK_VERSION } from "@dashi/applet";
import { createContext, useContext, useEffect, useState } from "react";
import { Catalog, DEFAULT_INDEX, keyFrom, storeCacheDir } from "../../src/applet-store/catalog.ts";
import { StoreImages } from "../../src/applet-store/images.ts";
import { AppletInstaller } from "../../src/applet-store/installer.ts";
import { DASHI_INDEX_KEY } from "../../src/applet-store/keys.ts";
import { readMachine } from "../../src/applet-store/machine.ts";
import { AppletStore } from "./model.ts";

export interface Services {
  store: AppletStore;
  images: StoreImages;
}

export function createServices(env: Readonly<Record<string, string | undefined>> = process.env): Services {
  const cache = storeCacheDir(env);
  const catalog = new Catalog({ url: env.DASHI_APPLETS_INDEX ?? DEFAULT_INDEX, key: keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY, cacheDir: cache });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    download: (url, size) => catalog.download(url, size),
  });
  return { store: new AppletStore(catalog, installer, () => readMachine(), SDK_VERSION), images: new StoreImages(`${cache}/images`) };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("the Applet Store's services are not provided");
  return services;
}

/** The file for an image URL: cached at once, else once downloaded; null until then. */
export function useStoreImage(url: string | null | undefined): string | null {
  const { images } = useServices();
  const [file, setFile] = useState<string | null>(() => images.cached(url ?? null));
  useEffect(() => {
    let current = true;
    const have = images.cached(url ?? null);
    setFile(have);
    if (have === null && url) void images.file(url).then((path) => current && setFile(path));
    return () => {
      current = false;
    };
  }, [images, url]);
  return file;
}
