/**
 * Every catalog's applets as one list for the store (pure). Each applet
 * remembers its catalog. One from a catalog the person added is never
 * reviewed (Dashi's review mark is Dashi's catalog's alone), and keeps only
 * the icon, screenshots and versions its catalog may serve (catalogs.ts
 * `allowedFor`). The same applet id in two catalogs: Dashi's wins, then the
 * one added first; an installed one is listed from the catalog it came from,
 * which alone updates it.
 */

import type { CatalogIndex, IndexApplet, InstallRecord } from "@dashi/applet";
import { allowedFor, type CatalogRef, type CatalogSource } from "./catalogs.ts";

/** An applet in the store: the index's entry and the catalog it came from. */
export interface StoreApplet extends IndexApplet {
  from: CatalogRef;
}

/** One catalog as loaded: its index (null when it didn't load), and why not. */
export interface CatalogLoad {
  source: CatalogSource;
  index: CatalogIndex | null;
  /** Served from the last good copy. */
  stale: boolean;
  problem: "offline" | "unsigned" | "invalid" | "no-key" | "other" | null;
}

/** The catalog an installed applet came from (its index address); null for one added by hand. Older records name none: Dashi's. */
export function installedFrom(record: Pick<InstallRecord, "source" | "catalog">, dashiUrl: string): string | null {
  return record.source === "local" ? null : (record.catalog ?? dashiUrl);
}

/** One catalog's applets, as the store may show them; an applet left with no version it may serve is left out. */
export function storeEntries(index: CatalogIndex, source: CatalogSource): StoreApplet[] {
  const from: CatalogRef = { name: source.name, url: source.url, builtIn: source.builtIn };
  const allowed = (url: string): boolean => allowedFor(source.url, url);
  return index.applets.flatMap((applet): StoreApplet[] => {
    const versions = applet.versions.filter((version) => allowed(version.url));
    if (versions.length === 0) return [];
    const { icon, ...rest } = applet;
    return [
      {
        ...rest,
        ...(icon !== undefined && allowed(icon) ? { icon } : {}),
        reviewed: source.builtIn && applet.reviewed,
        screenshots: applet.screenshots.filter(allowed),
        versions,
        from,
      },
    ];
  });
}

/**
 * The list: each id once, from the catalog that installed it when that one
 * still lists it, else from the first catalog that does (Dashi's is first).
 */
export function mergeCatalogs(
  loads: readonly CatalogLoad[],
  installed: ReadonlyArray<{ manifest: { id: string }; record: Pick<InstallRecord, "source" | "catalog"> }>,
  dashiUrl: string,
): StoreApplet[] {
  const perCatalog = loads.map((load) => (load.index ? storeEntries(load.index, load.source) : []));
  const origin = new Map(installed.map((applet) => [applet.manifest.id, installedFrom(applet.record, dashiUrl)]));
  const chosen = new Map<string, StoreApplet>();
  for (const entries of perCatalog) {
    for (const entry of entries) {
      const id = entry.manifest.id;
      const mine = origin.get(id);
      const have = chosen.get(id);
      if (!have) chosen.set(id, entry);
      else if (mine === entry.from.url && have.from.url !== mine) chosen.set(id, entry);
    }
  }
  return [...chosen.values()];
}

/** The entry for an installed applet in the catalog it came from; undefined when that catalog is gone or no longer lists it. */
export function entryFromItsCatalog(
  loads: readonly CatalogLoad[],
  applet: { manifest: { id: string }; record: Pick<InstallRecord, "source" | "catalog"> },
  dashiUrl: string,
): StoreApplet | undefined {
  const url = installedFrom(applet.record, dashiUrl);
  const load = loads.find((each) => each.source.url === url);
  return load?.index ? storeEntries(load.index, load.source).find((entry) => entry.manifest.id === applet.manifest.id) : undefined;
}
