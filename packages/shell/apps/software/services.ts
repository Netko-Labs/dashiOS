/** What the window talks to, made once: the catalog, the images, and the store of installed apps and updates. */

import { createContext, useContext } from "react";
import { ImageCache, JsonCache } from "../../src/software/cache.ts";
import { Flathub } from "../../src/software/flathub.ts";
import { Images } from "../../src/software/images.ts";
import { Software } from "../../src/software/manager.ts";
import { cacheRoot } from "../../src/software/paths.ts";
import { standIn } from "../../src/software/stand-in.ts";
import { SoftwareStore } from "./store.ts";

export interface Services {
  catalog: Flathub;
  images: Images;
  store: SoftwareStore;
  /** Restarts the machine, after the person asked (the shell's own path, refused outside a real session). */
  restart(): void;
}

export function createServices(restart: () => void): Services {
  const root = cacheRoot();
  const software = new Software(standIn() ?? {});
  return { catalog: new Flathub({ cache: new JsonCache(root) }), images: new Images(new ImageCache(root)), store: new SoftwareStore(software), restart };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("Software's services are not provided");
  return services;
}
