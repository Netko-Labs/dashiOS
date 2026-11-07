/**
 * The Flathub client (https://flathub.org/api/v2): collections, categories,
 * search, and an app's details, with answers cached on disk. A cached answer
 * younger than its time is served without asking; when the network is down
 * (or the server fails) the last answer is served marked `stale`, and only
 * with nothing cached does the call fail, as `offline`.
 */

import type { JsonCache } from "./cache.ts";
import { type FetchLike, getBytes, NetworkError } from "./fetch.ts";
import { parseCategories, parseDetails, parsePage, parseSizes, parseStats } from "./flathub-parse.ts";
import type { AppDetails, Page } from "./flathub-types.ts";
import { appIdOrNull } from "./ids.ts";
import { API_HOSTS } from "./parse-values.ts";

const API = "https://flathub.org/api/v2";
const MAX_ANSWER = 2_000_000;
const MINUTE = 60_000;

export type Collection = "popular" | "trending" | "recently-updated" | "recently-added";

/** Flathub's category names (the API is case-sensitive), as Software shows them. */
export const CATEGORIES = [
  { id: "AudioVideo", label: "Audio & Video" },
  { id: "Development", label: "Developer Tools" },
  { id: "Education", label: "Education" },
  { id: "Game", label: "Games" },
  { id: "Graphics", label: "Graphics & Photos" },
  { id: "Network", label: "Internet" },
  { id: "Office", label: "Productivity" },
  { id: "Science", label: "Science" },
  { id: "System", label: "System Tools" },
  { id: "Utility", label: "Utilities" },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function isCategory(value: unknown): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

/** An answer, and whether it is from the cache because the network could not be reached. */
export interface Answer<T> {
  value: T;
  stale: boolean;
}

export class CatalogError extends Error {
  constructor(
    readonly kind: "offline" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface FlathubOptions {
  cache: JsonCache;
  fetch?: FetchLike;
  /** How long a cached answer is served without asking, for lists and for an app. */
  listTtl?: number;
  detailsTtl?: number;
}

export class Flathub {
  private readonly cache: JsonCache;
  private readonly fetch: FetchLike | undefined;
  private readonly listTtl: number;
  private readonly detailsTtl: number;
  /** The apps whose pages were read this session, so a card can say what the page says (Get…). */
  private readonly read = new Map<string, AppDetails>();

  constructor(options: FlathubOptions) {
    this.cache = options.cache;
    this.fetch = options.fetch;
    this.listTtl = options.listTtl ?? 15 * MINUTE;
    this.detailsTtl = options.detailsTtl ?? 6 * 60 * MINUTE;
  }

  collection(kind: Collection, page = 1, perPage = 12): Promise<Answer<Page>> {
    return this.load(`${API}/collection/${kind}?page=${whole(page, 1, 500)}&per_page=${whole(perPage, 1, 48)}`, parsePage, this.listTtl);
  }

  category(category: CategoryId, page = 1, perPage = 24): Promise<Answer<Page>> {
    return this.load(`${API}/collection/category/${category}?page=${whole(page, 1, 500)}&per_page=${whole(perPage, 1, 48)}`, parsePage, this.listTtl);
  }

  /** Search is a POST, so it is cached under the request it makes. */
  search(query: string, page = 1, perPage = 24): Promise<Answer<Page>> {
    const body = JSON.stringify({ query: query.slice(0, 120), hits_per_page: whole(perPage, 1, 48), page: whole(page, 1, 500) });
    return this.load(`${API}/search`, parsePage, this.listTtl, { method: "POST", headers: { "content-type": "application/json" }, body }, `POST ${body}`);
  }

  categories(): Promise<Answer<string[]>> {
    return this.load(`${API}/collection/category`, parseCategories, 24 * 60 * MINUTE);
  }

  /**
   * An app's page: AppStream data and, when they answer, the summary (its
   * sizes and what its sandbox reaches) and how many installed it last month.
   */
  async details(id: string): Promise<Answer<AppDetails>> {
    const valid = appIdOrNull(id);
    if (valid === null) throw new CatalogError("failed", "not an application id");
    const [main, sizes, stats] = await Promise.allSettled([
      this.load(`${API}/appstream/${valid}`, parseDetails, this.detailsTtl),
      this.load(`${API}/summary/${valid}`, parseSizes, this.detailsTtl),
      this.load(`${API}/stats/${valid}`, parseStats, this.detailsTtl),
    ]);
    if (main.status === "rejected") throw main.reason;
    // The summary and the count are niceties; the page stands without them.
    let value = main.value.value;
    let stale = main.value.stale;
    if (sizes.status === "fulfilled") {
      value = { ...value, ...sizes.value.value };
      stale ||= sizes.value.stale;
    }
    if (stats.status === "fulfilled" && stats.value.value !== null) value = { ...value, installsLastMonth: stats.value.value };
    if (this.read.size >= 500) this.read.clear();
    this.read.set(valid, value);
    return { value, stale };
  }

  /** An app's page as read this session, without asking anyone; null when it wasn't. */
  detailsRead(id: string): AppDetails | null {
    return this.read.get(id) ?? null;
  }

  private async load<T>(url: string, parse: (value: unknown) => T, ttl: number, init?: RequestInit, key: string = url): Promise<Answer<T>> {
    const cacheKey = init ? `${url} ${key}` : url;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.age < ttl) {
      try {
        return { value: parse(cached.value), stale: false };
      } catch {
        // A cached answer that no longer parses is as good as none.
      }
    }
    try {
      const bytes = await getBytes(url, { hosts: API_HOSTS, maxBytes: MAX_ANSWER, init, fetch: this.fetch });
      const json = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const value = parse(json);
      this.cache.put(cacheKey, json);
      return { value, stale: false };
    } catch (error) {
      if (cached) {
        try {
          return { value: parse(cached.value), stale: true };
        } catch {
          // Nothing usable cached either.
        }
      }
      if (error instanceof NetworkError && error.kind === "offline")
        throw new CatalogError("offline", "Flathub can't be reached. Check the network connection.");
      throw new CatalogError(
        "failed",
        error instanceof NetworkError ? `Flathub gave an unexpected answer (${error.message}).` : "Flathub gave an answer Software could not read.",
      );
    }
  }
}

function whole(value: number, min: number, max: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(value, min), max) : min;
}
