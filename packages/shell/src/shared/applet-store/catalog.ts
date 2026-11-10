/**
 * One applet catalog (Software's Menu bar applets): its index.json and the
 * catalog's signature on it, checked before anything in it is believed
 * (@dashi/applet's catalog.ts). Dashi's is the catalog repository's `index`
 * branch on raw.githubusercontent.com (no API, no token), checked with
 * Dashi's key; one the person added is checked with the key they gave
 * (catalogs.ts). The last index that checked is kept, so the store works
 * offline and a bad answer never replaces a good one. An entry this Dashi
 * can't read is left out (and logged) and the rest are listed; a signature
 * that doesn't check still refuses all of it.
 *
 * `DASHI_APPLETS_INDEX` points Dashi's at another index (a fork, a test
 * catalog, file:// for checks); `DASHI_APPLETS_KEY` at another key (a .pub
 * file or the key's line).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type CatalogIndex, verifyIndex } from "@dashi/applet";
import { type FetchLike, getBytes, NetworkError } from "../software/fetch.ts";
import { digest } from "../software/paths.ts";

export const DEFAULT_INDEX = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
/** Where packages, icons, and screenshots may come from. */
export const CATALOG_HOSTS = ["raw.githubusercontent.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] as const;
const MAX_INDEX = 4 * 1024 * 1024;

export function storeCacheDir(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const base = env.XDG_CACHE_HOME;
  return join(base && isAbsolute(base) ? base : join(home, ".cache"), "dashi/applet-store");
}

/** Where a catalog's last good index is kept: Dashi's at the top (as before there were others), an added one by its address. */
export function catalogCacheDir(storeCache: string, url: string, builtIn: boolean): string {
  return builtIn ? storeCache : join(storeCache, "catalogs", digest(url));
}

export type CatalogProblem = "offline" | "unsigned" | "invalid" | "no-key";

export class CatalogError extends Error {
  constructor(
    readonly kind: CatalogProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface CatalogOptions {
  url: string;
  /** The catalog's public key (minisign): Dashi's, null when this build has none yet, or the one the person gave. */
  key: string | null;
  cacheDir: string;
  fetch?: FetchLike;
}

/** The key a `DASHI_APPLETS_KEY` names: a file's contents, or the line itself. */
export function keyFrom(value: string | undefined): string | null {
  if (!value) return null;
  return isAbsolute(value) && existsSync(value) ? readFileSync(value, "utf8") : value;
}

async function bytesOf(url: string, hosts: readonly string[], fetcher?: FetchLike): Promise<Uint8Array> {
  if (url.startsWith("file://")) return new Uint8Array(readFileSync(new URL(url)));
  return getBytes(url, { hosts, maxBytes: MAX_INDEX, ...(fetcher ? { fetch: fetcher } : {}) });
}

/** Where a catalog's index, packages, icons and screenshots may come from: Dashi's hosts and its index's own, https only. */
export function hostsFor(indexUrl: string): string[] {
  let own: string | null = null;
  try {
    const { protocol, hostname } = new URL(indexUrl);
    own = protocol === "https:" ? hostname.toLowerCase() : null;
  } catch {
    own = null;
  }
  return own === null || (CATALOG_HOSTS as readonly string[]).includes(own) ? [...CATALOG_HOSTS] : [...CATALOG_HOSTS, own];
}

export interface Loaded {
  index: CatalogIndex;
  /** Served from the last good copy (offline, or the answer didn't check). */
  stale: boolean;
}

export class Catalog {
  constructor(private readonly options: CatalogOptions) {}

  /** Its index.json's address: which catalog this is. */
  get url(): string {
    return this.options.url;
  }

  /** Whether there is a key to check the index with: without one nothing from the catalog can be shown. */
  get hasKey(): boolean {
    return this.options.key !== null && this.options.key.trim() !== "";
  }

  private cached(): CatalogIndex | null {
    const { key, cacheDir } = this.options;
    const json = join(cacheDir, "index.json");
    const sig = join(cacheDir, "index.json.minisig");
    if (!key || !existsSync(json) || !existsSync(sig)) return null;
    // Checked again: the cache is a file in the home folder like any other.
    const index = verifyIndex(new Uint8Array(readFileSync(json)), readFileSync(sig, "utf8"), key);
    return "error" in index ? null : index;
  }

  /** The index fetched now and checked, or why not; nothing saved is used. */
  private async fetchChecked(): Promise<{ index: CatalogIndex; bytes: Uint8Array; signature: string }> {
    const { url, key } = this.options;
    if (!key) throw new CatalogError("no-key", "This Dashi has no key for the applet catalog yet.");
    const hosts = hostsFor(url);
    let bytes: Uint8Array;
    let signature: string;
    try {
      [bytes, signature] = await Promise.all([
        bytesOf(url, hosts, this.options.fetch),
        bytesOf(`${url}.minisig`, hosts, this.options.fetch).then((sig) => new TextDecoder().decode(sig)),
      ]);
    } catch (error) {
      throw new CatalogError("offline", error instanceof NetworkError ? error.message : "The catalog can't be reached.");
    }
    const index = verifyIndex(bytes, signature, key);
    if ("error" in index) throw new CatalogError(index.error.startsWith("the index isn't signed") ? "unsigned" : "invalid", index.error);
    return { index, bytes, signature };
  }

  private save(bytes: Uint8Array, signature: string): void {
    const { cacheDir } = this.options;
    mkdirSync(cacheDir, { recursive: true });
    for (const [name, data] of [
      ["index.json", bytes],
      ["index.json.minisig", signature],
    ] as const) {
      writeFileSync(join(cacheDir, `${name}.new`), data);
      renameSync(join(cacheDir, `${name}.new`), join(cacheDir, name));
    }
  }

  /** Says in the log which entries were left out of `index`, and why: the rest of it is listed. */
  private logSkipped(index: CatalogIndex): CatalogIndex {
    for (const each of index.skipped) console.error(`dashi-shell: ${this.options.url}: skipped ${each.id ?? "an entry with no id"}: ${each.reason}`);
    return index;
  }

  /** The index, checked; the saved one when the network fails or the answer doesn't check; an error when neither is to be had. */
  async load(): Promise<Loaded> {
    let fresh: Awaited<ReturnType<Catalog["fetchChecked"]>>;
    try {
      fresh = await this.fetchChecked();
    } catch (error) {
      const saved = error instanceof CatalogError && error.kind === "no-key" ? null : this.cached();
      if (saved) return { index: this.logSkipped(saved), stale: true };
      throw error;
    }
    this.save(fresh.bytes, fresh.signature);
    return { index: this.logSkipped(fresh.index), stale: false };
  }

  /** Adding a catalog: its index now, checked with its key, never a saved copy; kept once it checks. */
  async check(): Promise<CatalogIndex> {
    const fresh = await this.fetchChecked();
    this.save(fresh.bytes, fresh.signature);
    return this.logSkipped(fresh.index);
  }

  /**
   * A package's bytes (checked by the installer, not here): https from
   * Dashi's hosts or the index's own; a local file only for a catalog that
   * is one itself (a test catalog).
   */
  download(url: string, size: number): Promise<Uint8Array> {
    if (url.startsWith("file://")) {
      if (!this.options.url.startsWith("file://")) return Promise.reject(new NetworkError("refused", "a catalog on the web can't list a local file"));
      return Promise.resolve(new Uint8Array(readFileSync(new URL(url))));
    }
    const hosts = hostsFor(this.options.url);
    return getBytes(url, { hosts, maxBytes: size, timeoutMs: 120_000, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) });
  }
}
