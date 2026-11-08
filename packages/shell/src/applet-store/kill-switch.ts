/**
 * The kill switch without the store open: a few minutes after login and
 * then once a day, the shell fetches the index of each catalog an installed
 * applet came from (each checked with its own key, as the store does) and
 * turns off every installed version that catalog lists as pulled. An applet
 * answers only to its own catalog's list; one whose catalog was removed has
 * none. The launcher sees the change in the applets folder and stops it.
 * Nothing is installed or updated here; that is the person's, in Software.
 */

import { appletDataRoot, appletsRoot, SDK_VERSION } from "@dashi/applet";
import { settingsPath } from "../settings.ts";
import type { Catalog } from "./catalog.ts";
import { keyFrom, storeCacheDir } from "./catalog.ts";
import { CatalogSet, readSavedCatalogs } from "./catalog-set.ts";
import { dashiCatalog } from "./catalogs.ts";
import { AppletInstaller } from "./installer.ts";
import { DASHI_INDEX_KEY } from "./keys.ts";

const FIRST_MS = 3 * 60_000;
const EVERY_MS = 24 * 60 * 60_000;

/** One look, at each catalog that installed something: the ids it turned off (none when nothing could be checked, or nothing was pulled). */
export async function applyKillSwitch(catalogs: ReadonlyArray<Pick<Catalog, "url" | "load">>, installer: AppletInstaller): Promise<string[]> {
  const origins = new Set(installer.installed().map((applet) => installer.catalogOf(applet)));
  const looks = catalogs
    .filter((catalog) => origins.has(catalog.url))
    .map(async (catalog) => {
      try {
        const { index } = await catalog.load();
        return installer.disablePulled(index, catalog.url);
      } catch {
        return [];
      }
    });
  return (await Promise.all(looks)).flat();
}

/** Starts the daily look; returns what stops it. */
export function watchKillSwitch(env: Readonly<Record<string, string | undefined>> = process.env): () => void {
  const dashi = dashiCatalog(env, keyFrom(env.DASHI_APPLETS_KEY) ?? DASHI_INDEX_KEY);
  const path = settingsPath(env);
  const set = new CatalogSet({
    dashi,
    cacheDir: storeCacheDir(env),
    saved: {
      read: () => readSavedCatalogs(path, dashi.url).catalogs,
      write: () => "the kill switch saves nothing",
    },
  });
  const installer = new AppletInstaller({
    root: appletsRoot(),
    dataRoot: appletDataRoot(),
    dashiVersion: SDK_VERSION,
    dashiCatalog: dashi.url,
    download: () => Promise.reject(new Error("the kill switch downloads nothing")),
  });
  const look = (): void => {
    // The list is read each time: a catalog added or removed since login counts.
    const catalogs = set
      .sources()
      .filter((source) => source.key !== null)
      .map((source) => set.catalogFor(source));
    void applyKillSwitch(catalogs, installer).then((ids) => {
      if (ids.length > 0) console.error(`dashi-shell: pulled from an applet catalog, turned off: ${ids.join(", ")}`);
    });
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
