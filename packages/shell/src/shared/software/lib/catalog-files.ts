/**
 * The catalog's files on disk, under `<software cache>/catalog/`: Flathub's
 * `appstream.xml.gz` as it was last fetched (with its ETag, so most days the
 * request is a 304), and each AppStream file already read, as JSON keyed by
 * the source file's size and time, so a second open reads small JSON instead
 * of 50 MB of XML. Every read is checked; a bad file is read again from its
 * source.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { isRecord } from "@dashi/shape";
import { type FetchLike, getBytes } from "../fetch.ts";
import { type AppStreamApp, iconFile, originOf, parseAppStream } from "./appstream.ts";

export const FLATHUB_APPSTREAM = "https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz";
const FLATHUB_HOSTS = ["dl.flathub.org"];
const MAX_FLATHUB = 64 * 1024 * 1024;
/** Fedora's own catalog, from `appstream-data` (RPM Fusion's beside it). */
export const SWCATALOG = "/usr/share/swcatalog";
/** Parsed files are re-read when this changes. */
const PARSED_FORMAT = 1;

function writeAtomic(path: string, data: string | Uint8Array): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

function isApp(value: unknown): value is AppStreamApp {
  return (
    isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.summary === "string" && Array.isArray(value.keywords)
  );
}

/** An AppStream file read before, if it still matches its source (`stamp`). */
function readParsed(path: string, stamp: string): AppStreamApp[] | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(value) || value.format !== PARSED_FORMAT || value.stamp !== stamp || !Array.isArray(value.apps)) return null;
    return value.apps.filter(isApp);
  } catch {
    return null;
  }
}

function stampOf(path: string): string | null {
  try {
    const info = statSync(path);
    return `${info.size}:${Math.round(info.mtimeMs)}`;
  } catch {
    return null;
  }
}

function decode(path: string): string {
  const bytes = readFileSync(path);
  return new TextDecoder().decode(path.endsWith(".gz") ? gunzipSync(bytes) : bytes);
}

/** Reads an AppStream file through the parsed copy; `adjust` runs on a fresh parse only (icons turned into files). */
export function appStreamFile(
  source: string,
  dir: string,
  name: string,
  adjust: (apps: AppStreamApp[], xml: string) => AppStreamApp[] = (apps) => apps,
): AppStreamApp[] {
  const stamp = stampOf(source);
  if (stamp === null) return [];
  mkdirSync(dir, { recursive: true });
  const parsed = join(dir, `${name}.json`);
  const have = readParsed(parsed, stamp);
  if (have !== null) return have;
  const xml = decode(source);
  const apps = adjust(parseAppStream(xml), xml);
  writeAtomic(parsed, JSON.stringify({ format: PARSED_FORMAT, stamp, apps }));
  return apps;
}

/** Fedora's and RPM Fusion's catalogs, with cached icon names turned into files under `/usr/share/swcatalog/icons`. */
export function systemAppStream(dir: string, root = SWCATALOG, exists: (path: string) => boolean = existsSync): AppStreamApp[] {
  let files: string[];
  try {
    files = readdirSync(join(root, "xml")).filter((file) => /\.xml(\.gz)?$/.test(file));
  } catch {
    return [];
  }
  return files.flatMap((file) =>
    appStreamFile(join(root, "xml", file), dir, `system-${file.replace(/[^A-Za-z0-9.-]/g, "_")}`, (apps, xml) => {
      const origin = originOf(xml) ?? "";
      return apps.map((app) => {
        if (app.icon?.kind !== "cached") return app;
        const path = iconFile(root, origin, app.icon.value, exists);
        return { ...app, icon: path === null ? null : { kind: "cached" as const, value: path } };
      });
    }),
  );
}

/**
 * Flathub's catalog file: fetched when the copy is older than `maxAgeMs` (or
 * missing), conditionally on its ETag; offline, the copy is used as it is.
 * Returns the local file, or null when there has never been one.
 */
export async function flathubFile(dir: string, options: { fetch?: FetchLike; now?: number; maxAgeMs?: number; online?: boolean } = {}): Promise<string | null> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "flathub-appstream.xml.gz");
  const tagFile = join(dir, "flathub-appstream.etag");
  const now = options.now ?? Date.now();
  let age = Number.POSITIVE_INFINITY;
  try {
    age = now - statSync(file).mtimeMs;
  } catch {
    // None yet.
  }
  if (age < (options.maxAgeMs ?? 24 * 3600_000) || options.online === false) return Number.isFinite(age) ? file : null;
  const etag = existsSync(tagFile) && Number.isFinite(age) ? readFileSync(tagFile, "utf8").trim().slice(0, 200) : "";
  let status = 200;
  let tag = "";
  const fetcher: FetchLike = async (url, init) => {
    const response = await (options.fetch ?? fetch)(url, init);
    status = response.status;
    tag = response.headers.get("etag") ?? "";
    // A 304 has no body: answer an empty 200 so getBytes takes it.
    return status === 304 ? new Response(new Uint8Array(), { status: 200 }) : response;
  };
  try {
    const bytes = await getBytes(FLATHUB_APPSTREAM, {
      hosts: FLATHUB_HOSTS,
      maxBytes: MAX_FLATHUB,
      timeoutMs: 120_000,
      fetch: fetcher,
      ...(etag ? { init: { headers: { "if-none-match": etag } } } : {}),
    });
    if (status === 304) {
      const at = new Date(now);
      utimesSync(file, at, at);
    } else {
      writeAtomic(file, bytes);
      if (tag) writeAtomic(tagFile, tag);
    }
    return file;
  } catch {
    return Number.isFinite(age) ? file : null;
  }
}
