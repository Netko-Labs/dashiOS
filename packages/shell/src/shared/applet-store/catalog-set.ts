/**
 * The catalogs the store reads, loaded: Dashi's and the ones the person
 * added (saved in the settings file, catalogs.ts). Each is a Catalog of its
 * own, checked with its own key and cached apart. Adding one checks its
 * index with the key given before anything is saved; removing one forgets
 * it (its applets stay installed, with no updates).
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import type { FetchLike } from "../software/index.ts";
import { Catalog, CatalogError, catalogCacheDir } from "./catalog.ts";
import { type CatalogDraft, type CatalogSetting, type CatalogSource, catalogProblemWords, catalogSources, checkDraft, parseCatalogs } from "./catalogs.ts";
import type { CatalogLoad } from "./merge.ts";

/** Where the added catalogs are kept: read every time (the file may change), written by the person's own action. */
export interface SavedCatalogs {
  read(): CatalogSetting[];
  /** Saves the list; why not, in words, when it couldn't be. */
  write(catalogs: readonly CatalogSetting[]): string | null;
}

/** `applets.catalogs` from the settings file at `path`, read as untrusted: the good entries; nothing when the file is missing or isn't JSON. */
export function readSavedCatalogs(path: string, dashiUrl: string): { catalogs: CatalogSetting[]; problems: string[] } {
  if (!existsSync(path)) return { catalogs: [], problems: [] };
  try {
    const root: unknown = JSON.parse(readFileSync(path, "utf8"));
    const applets = typeof root === "object" && root !== null && !Array.isArray(root) ? (root as Record<string, unknown>).applets : undefined;
    const catalogs = typeof applets === "object" && applets !== null && !Array.isArray(applets) ? (applets as Record<string, unknown>).catalogs : undefined;
    return parseCatalogs(catalogs, dashiUrl);
  } catch {
    return { catalogs: [], problems: [] };
  }
}

export interface CatalogSetOptions {
  dashi: CatalogSource;
  saved: SavedCatalogs;
  /** The store's cache (catalog.ts `storeCacheDir`). */
  cacheDir: string;
  fetch?: FetchLike;
}

export class CatalogSet {
  private readonly made = new Map<string, Catalog>();

  constructor(private readonly options: CatalogSetOptions) {}

  get dashiUrl(): string {
    return this.options.dashi.url;
  }

  /** Every catalog, Dashi's first. */
  sources(): CatalogSource[] {
    return catalogSources(this.options.dashi, this.options.saved.read());
  }

  /** The Catalog for `source`, made once per address and key. */
  catalogFor(source: CatalogSource): Catalog {
    const id = `${source.url}\n${source.key ?? ""}`;
    let catalog = this.made.get(id);
    if (!catalog) {
      catalog = new Catalog({
        url: source.url,
        key: source.key,
        cacheDir: catalogCacheDir(this.options.cacheDir, source.url, source.builtIn),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      this.made.set(id, catalog);
    }
    return catalog;
  }

  /** Every catalog loaded at once; one that fails says why and the rest still load. */
  loadAll(): Promise<CatalogLoad[]> {
    return Promise.all(
      this.sources().map(async (source): Promise<CatalogLoad> => {
        try {
          const { index, stale } = await this.catalogFor(source).load();
          return { source, index, stale, problem: null };
        } catch (error) {
          return { source, index: null, stale: false, problem: error instanceof CatalogError ? error.kind : "other" };
        }
      }),
    );
  }

  /** A package's bytes, by the rules of the catalog at `catalog` (which must still be in the list). */
  download(url: string, size: number, catalog: string): Promise<Uint8Array> {
    const source = this.sources().find((each) => each.url === catalog);
    if (!source) return Promise.reject(new Error("that applet’s catalog was removed"));
    return this.catalogFor(source).download(url, size);
  }

  /**
   * Adds a catalog: what was typed must make sense, and its index must be
   * there and signed by the key given, before it is saved. Null when it was
   * added; why not, in people's words, otherwise.
   */
  async add(draft: CatalogDraft): Promise<string | null> {
    const checked = checkDraft(draft, this.sources());
    if ("error" in checked) return checked.error;
    const source: CatalogSource = { ...checked, builtIn: false };
    try {
      await this.catalogFor(source).check();
    } catch (error) {
      return catalogProblemWords(error instanceof CatalogError ? (error.kind === "invalid" ? "other" : error.kind) : "other");
    }
    const failed = this.options.saved.write([...this.options.saved.read(), checked]);
    return failed === null ? null : `Dashi couldn’t save the list of catalogs: ${failed}`;
  }

  /** Forgets an added catalog (never Dashi's) and its saved index; what was installed from it stays. Why not, in words, or null. */
  remove(url: string): string | null {
    const saved = this.options.saved.read();
    if (!saved.some((each) => each.url === url)) return null;
    const failed = this.options.saved.write(saved.filter((each) => each.url !== url));
    if (failed !== null) return `Dashi couldn’t save the list of catalogs: ${failed}`;
    rmSync(catalogCacheDir(this.options.cacheDir, url, false), { recursive: true, force: true });
    for (const id of [...this.made.keys()]) if (id.startsWith(`${url}\n`)) this.made.delete(id);
    return null;
  }
}
