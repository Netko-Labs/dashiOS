/**
 * The catalogs' icons and screenshots as files (Metal draws images from
 * paths): fetched once per URL from the catalogs' hosts only (each
 * catalog's own are checked when its applets are listed, merge.ts), at most
 * 4 MB, kept in the store's cache under a hash of the URL.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, type FetchLike, getBytes } from "../software/index.ts";
import { CATALOG_HOSTS } from "./catalog.ts";

const MAX_IMAGE = 4 * 1024 * 1024;

export class StoreImages {
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly dir: string,
    private readonly fetch?: FetchLike,
    /** The hosts images may come from now: every catalog's (catalog.ts `hostsFor`). */
    private readonly hosts: () => readonly string[] = () => CATALOG_HOSTS,
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
    const job = getBytes(url, { hosts: this.hosts(), maxBytes: MAX_IMAGE, ...(this.fetch ? { fetch: this.fetch } : {}) })
      .then((bytes) => {
        mkdirSync(this.dir, { recursive: true });
        // Beside it, then renamed in place: a file at `path` is always a whole picture, which `cached` takes it for.
        const partial = `${path}.${process.pid}.partial`;
        writeFileSync(partial, bytes);
        renameSync(partial, path);
        return path;
      })
      .catch(() => null)
      .finally(() => this.pending.delete(url));
    this.pending.set(url, job);
    return job;
  }
}
