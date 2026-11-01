/**
 * Icons and screenshots as files in the image cache, because Metal draws
 * images from local paths. Fetched at most a few at a time, once per URL
 * (calls for the same URL share the download); only Flathub's media host,
 * only real images, and never more than the cache's limits.
 */

import { ImageCache, LIMITS } from "./cache.ts";
import { type FetchLike, getBytes } from "./fetch.ts";
import { httpsUrl, MEDIA_HOSTS } from "./parse-values.ts";

const CONCURRENT = 4;

export class Images {
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly failed = new Set<string>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly cache: ImageCache,
    private readonly fetch?: FetchLike,
  ) {}

  /** The cached file for `url` if it is already here (no network). */
  cached(url: string | null): string | null {
    return url === null ? null : this.cache.get(url);
  }

  /** The file for `url`, downloading it if need be; null when it can't be had. */
  file(url: string | null): Promise<string | null> {
    if (url === null || httpsUrl(url, MEDIA_HOSTS) === null) return Promise.resolve(null);
    const have = this.cache.get(url);
    if (have) return Promise.resolve(have);
    if (this.failed.has(url)) return Promise.resolve(null);
    let job = this.pending.get(url);
    if (!job) {
      job = this.download(url).finally(() => this.pending.delete(url));
      this.pending.set(url, job);
    }
    return job;
  }

  private async download(url: string): Promise<string | null> {
    await this.slot();
    try {
      const bytes = await getBytes(url, { hosts: MEDIA_HOSTS, maxBytes: LIMITS.imageEntry, fetch: this.fetch, timeoutMs: 30_000 });
      const path = this.cache.put(url, bytes);
      if (path === null) this.failed.add(url);
      return path;
    } catch {
      // Offline now does not mean never: only a bad image is remembered as bad.
      return null;
    } finally {
      this.release();
    }
  }

  private slot(): Promise<void> {
    if (this.running < CONCURRENT) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }
}
