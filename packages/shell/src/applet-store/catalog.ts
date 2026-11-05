/**
 * The Applet Store's catalog: index.json and Dashi's signature on it, from
 * the catalog repository's `index` branch on raw.githubusercontent.com (no
 * API, no token), checked before anything in it is believed
 * (@dashi/applet's catalog.ts). The last index that checked is kept, so the
 * store works offline and a bad answer never replaces a good one.
 *
 * `DASHI_APPLETS_INDEX` points at another index (a fork, a test catalog,
 * file:// for checks); `DASHI_APPLETS_KEY` at another key (a .pub file or the
 * key's line).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { type CatalogIndex, verifyIndex } from "@dashi/applet";
import { type FetchLike, getBytes, NetworkError } from "../software/fetch.ts";

export const DEFAULT_INDEX = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
/** Where packages, icons, and screenshots may come from. */
export const CATALOG_HOSTS = ["raw.githubusercontent.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] as const;
const MAX_INDEX = 4 * 1024 * 1024;

export function storeCacheDir(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const base = env.XDG_CACHE_HOME;
  return join(base && isAbsolute(base) ? base : join(home, ".cache"), "dashi/applet-store");
}

export class CatalogError extends Error {
  constructor(
    readonly kind: "offline" | "unsigned" | "no-key",
    message: string,
  ) {
    super(message);
  }
}

export interface CatalogOptions {
  url: string;
  /** Dashi's public key (minisign); null when this build has none yet. */
  key: string | null;
  cacheDir: string;
  fetch?: FetchLike;
}

/** The key a `DASHI_APPLETS_KEY` names: a file's contents, or the line itself. */
export function keyFrom(value: string | undefined): string | null {
  if (!value) return null;
  return isAbsolute(value) && existsSync(value) ? readFileSync(value, "utf8") : value;
}

async function bytesOf(url: string, fetcher?: FetchLike): Promise<Uint8Array> {
  if (url.startsWith("file://")) return new Uint8Array(readFileSync(new URL(url)));
  return getBytes(url, { hosts: CATALOG_HOSTS, maxBytes: MAX_INDEX, ...(fetcher ? { fetch: fetcher } : {}) });
}

export interface Loaded {
  index: CatalogIndex;
  /** Served from the last good copy (offline, or the answer didn't check). */
  stale: boolean;
}

export class Catalog {
  constructor(private readonly options: CatalogOptions) {}

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

  /** The index, checked; the saved one when the network fails; an error when neither is to be had. */
  async load(): Promise<Loaded> {
    const { url, key, cacheDir } = this.options;
    if (!key) throw new CatalogError("no-key", "This Dashi has no key for the applet catalog yet.");
    let bytes: Uint8Array;
    let signature: string;
    try {
      [bytes, signature] = await Promise.all([
        bytesOf(url, this.options.fetch),
        bytesOf(`${url}.minisig`, this.options.fetch).then((sig) => new TextDecoder().decode(sig)),
      ]);
    } catch (error) {
      const saved = this.cached();
      if (saved) return { index: saved, stale: true };
      throw new CatalogError("offline", error instanceof NetworkError ? error.message : "The catalog can't be reached.");
    }
    const index = verifyIndex(bytes, signature, key);
    if ("error" in index) {
      const saved = this.cached();
      if (saved) return { index: saved, stale: true };
      throw new CatalogError("unsigned", index.error);
    }
    mkdirSync(cacheDir, { recursive: true });
    for (const [name, data] of [
      ["index.json", bytes],
      ["index.json.minisig", signature],
    ] as const) {
      writeFileSync(join(cacheDir, `${name}.new`), data);
      renameSync(join(cacheDir, `${name}.new`), join(cacheDir, name));
    }
    return { index, stale: false };
  }

  /** A package's bytes (checked by the installer, not here). */
  download(url: string, size: number): Promise<Uint8Array> {
    if (url.startsWith("file://")) return Promise.resolve(new Uint8Array(readFileSync(new URL(url))));
    return getBytes(url, { hosts: CATALOG_HOSTS, maxBytes: size, timeoutMs: 120_000, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) });
  }
}
