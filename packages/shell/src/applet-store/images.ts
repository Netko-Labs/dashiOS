/**
 * The catalog's icons and screenshots as files (Metal draws images from
 * paths): fetched once per URL from the catalog's hosts only, at most 4 MB,
 * kept in the store's cache under a hash of the URL.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FetchLike, getBytes } from "../software/fetch.ts";
import { digest } from "../software/paths.ts";
import { CATALOG_HOSTS } from "./catalog.ts";

const MAX_IMAGE = 4 * 1024 * 1024;

export class StoreImages {
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir: string,
    private readonly fetch?: FetchLike,
  ) {}

  private pathFor(url: string): string | null {
    const extension = /\.(png|jpe?g|webp|svg)(\?|$)/i.exec(url)?.[1]?.toLowerCase();
    return extension ? join(this.dir, `${digest(url)}.${extension === "jpeg" ? "jpg" : extension}`) : null;
  }

  cached(url: string | null): string | null {
    if (url === null) return null;
    const path = this.pathFor(url);
    return path && existsSync(path) ? path : null;
  }

  file(url: string): Promise<string | null> {
    const have = this.cached(url);
    if (have) return Promise.resolve(have);
    const path = this.pathFor(url);
    if (!path) return Promise.resolve(null);
    const running = this.pending.get(url);
    if (running) return running;
    const job = getBytes(url, { hosts: CATALOG_HOSTS, maxBytes: MAX_IMAGE, ...(this.fetch ? { fetch: this.fetch } : {}) })
      .then((bytes) => {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(path, bytes);
        return path;
      })
      .catch(() => null)
      .finally(() => this.pending.delete(url));
    this.pending.set(url, job);
    return job;
  }
}
