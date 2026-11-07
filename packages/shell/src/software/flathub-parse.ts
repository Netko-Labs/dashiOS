/**
 * Flathub's API answers (https://flathub.org/api/v2), read strictly: a
 * record whose app id or name is not valid is dropped, a field of the wrong
 * type is absent, long text is cut, and URLs must be HTTPS on Flathub's own
 * hosts. Unknown fields are ignored. Fixtures are in test/fixtures/software.
 */

import type { AppDetails, AppSummary, Page, Release, Screenshot, Sizes } from "./flathub-types.ts";
import { parsePermissions } from "./flatpak-permissions.ts";
import { descriptionBlocks } from "./html.ts";
import { appIdOrNull } from "./ids.ts";
import { count, displayUrl, flag, httpsUrl, isRecord, type JsonRecord, list, MEDIA_HOSTS, text, whole } from "./parse-values.ts";

const MAX_HITS = 100;

/** One search/collection hit, or null when it lacks a valid id and a name. */
export function parseSummary(value: unknown): AppSummary | null {
  if (!isRecord(value)) return null;
  const id = appIdOrNull(value.app_id ?? value.id);
  const name = text(value, "name", 100);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    summary: text(value, "summary", 300) ?? "",
    developer: text(value, "developer_name", 100),
    icon: httpsUrl(value.icon, MEDIA_HOSTS),
    verified: flag(value, "verification_verified"),
    category: text(value, "main_categories", 40),
    license: text(value, "project_license", 80),
    installsLastMonth: count(value, "installs_last_month"),
    updatedAt: whole(value.updated_at),
  };
}

/** A page of hits: `{hits: [...], page, totalPages, totalHits}`. Throws when it is not one. */
export function parsePage(value: unknown): Page {
  if (!isRecord(value) || !Array.isArray(value.hits)) throw new Error("not a page of apps");
  const seen = new Set<string>();
  const apps: AppSummary[] = [];
  for (const hit of value.hits.slice(0, MAX_HITS)) {
    const app = parseSummary(hit);
    if (app && !seen.has(app.id)) {
      seen.add(app.id);
      apps.push(app);
    }
  }
  const page = count(value, "page") ?? 1;
  return { apps, page, totalPages: count(value, "totalPages") ?? page, total: count(value, "totalHits") ?? apps.length };
}

/** `["audiovideo", ...]`: the category ids. Entries that are not simple words are dropped. */
export function parseCategories(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("not a list of categories");
  return value.filter((each): each is string => typeof each === "string" && /^[a-z]{2,24}$/.test(each)).slice(0, 40);
}

function parseScreenshot(value: unknown): Screenshot | null {
  if (!isRecord(value) || !Array.isArray(value.sizes)) return null;
  const sizes = value.sizes
    .map((size) => {
      if (!isRecord(size)) return null;
      const src = httpsUrl(size.src, MEDIA_HOSTS);
      const width = whole(size.width);
      const height = whole(size.height);
      return src && width && height && width <= 20_000 && height <= 20_000 ? { src, width, height } : null;
    })
    .filter((size): size is { src: string; width: number; height: number } => size !== null);
  if (sizes.length === 0) return null;
  // The large one: the biggest up to 1000 px wide (a full-size original can be megabytes); else the smallest there is.
  const byWidth = [...sizes].sort((a, b) => a.width - b.width);
  const large = [...byWidth].reverse().find((size) => size.width <= 1000) ?? byWidth[0];
  const thumb = byWidth.find((size) => size.width >= 200) ?? byWidth[0];
  if (!large || !thumb) return null;
  return { caption: text(value, "caption", 120), thumb: thumb.src, large: large.src, width: large.width, height: large.height };
}

const SHOWN_RELEASES = 3;
const MAX_NOTES = 8;

/** The stable releases, newest first, with their notes as plain paragraphs. */
export function parseReleases(releases: unknown[], max = SHOWN_RELEASES): Release[] {
  return releases
    .filter((release): release is JsonRecord => isRecord(release) && (release.type === undefined || release.type === null || release.type === "stable"))
    .map((release) => ({
      version: text(release, "version", 40),
      released: whole(release.timestamp),
      notes: typeof release.description === "string" ? descriptionBlocks(release.description).slice(0, MAX_NOTES) : [],
    }))
    .sort((a, b) => (b.released ?? 0) - (a.released ?? 0))
    .slice(0, max);
}

/** `appstream/<id>`: the app page's data. Throws when the answer is not an app. */
export function parseDetails(value: unknown): AppDetails {
  if (!isRecord(value)) throw new Error("not an app");
  const summary = parseSummary({ ...value, app_id: value.id });
  if (!summary) throw new Error("not a valid app");
  const metadata = isRecord(value.metadata) ? value.metadata : ({} as JsonRecord);
  const urls = isRecord(value.urls) ? value.urls : ({} as JsonRecord);
  const bundle = isRecord(value.bundle) ? value.bundle : ({} as JsonRecord);
  const icons = list(value, "icons", 20).filter(isRecord);
  const icon = summary.icon ?? httpsUrl(icons.find((each) => each.type === "remote" && httpsUrl(each.url, MEDIA_HOSTS))?.url, MEDIA_HOSTS);
  const releases = parseReleases(list(value, "releases", 50));
  const version = releases[0]?.version ?? null;
  const released = releases[0]?.released ?? null;
  return {
    ...summary,
    icon,
    developer: summary.developer,
    verified: summary.verified || metadata["flathub::verification::verified"] === true,
    category: summary.category ?? null,
    license: text(value, "project_license", 80),
    description: typeof value.description === "string" ? descriptionBlocks(value.description) : [],
    screenshots: list(value, "screenshots", 12)
      .map(parseScreenshot)
      .filter((shot): shot is Screenshot => shot !== null),
    homepage: displayUrl(urls.homepage),
    version,
    released,
    runtime: text(bundle, "runtime", 120),
    eol: flag(value, "is_eol"),
    downloadSize: null,
    installedSize: null,
    categories: list(value, "categories", 12).filter((each): each is string => typeof each === "string" && /^[A-Za-z]{2,30}$/.test(each)),
    releases,
    permissions: null,
  };
}

/** `summary/<id>`: the download and installed sizes, in bytes, and what the sandbox lets it reach. */
export function parseSizes(value: unknown): Sizes {
  if (!isRecord(value)) throw new Error("not a summary");
  return { downloadSize: count(value, "download_size"), installedSize: count(value, "installed_size"), permissions: parsePermissions(value) };
}

/** `stats/<id>`: how many installed it last month, or null. */
export function parseStats(value: unknown): number | null {
  return isRecord(value) ? count(value, "installs_last_month") : null;
}
