/**
 * The catalog's index (Netko-Labs/dashi-applets' index.json, built by its CI)
 * and the checks that come before anything runs:
 *
 *   1. the index is signed by its catalog's key (index.json.minisig): Dashi's
 *      for Dashi's catalog, the one the person gave for a catalog they added;
 *   2. a package's bytes have the size and sha256 the index lists;
 *   3. the package is signed by its author's key, which the index lists;
 *   4. an update is signed by the same key as the installed version;
 *   5. a version the index lists as pulled is never installed, and is
 *      disabled where it already is (the kill switch).
 *
 * The signature covers the whole index and is checked before any of it is
 * read. Then each applet's entry is read alone: one this Dashi can't read (a
 * permission it doesn't know yet) is skipped, never installable, and the rest
 * are listed.
 *
 * The format is in docs/applets.md, "The catalog". Everything here is pure:
 * fetching and files are the store's and the shell's.
 */

import { isRecord } from "@dashi/shape";
import { isRefusal, list, optionalBoolean, optionalText, type Refusal, record, refuse, text } from "@dashi/shape/kit";
import { compareVersions, dashiSatisfies, isAppletId, type Manifest, parseManifest } from "./manifest.ts";
import { sha256 } from "./package.ts";
import { parsePublicKey, verify } from "./signing/minisign.ts";

export const INDEX_FORMAT = 1;

export interface IndexVersion {
  version: string;
  dashi: string;
  url: string;
  sha256: string;
  size: number;
  /** The author's .minisig over the package, in full. */
  signature: string;
  /** YYYY-MM-DD */
  released: string;
  notes?: string;
}

export interface IndexApplet {
  /** The newest version's manifest: what the store shows and the sandbox would give. */
  manifest: Manifest;
  /** The author's public key (minisign's base64 line). */
  authorKey: string;
  /** Checked by Dashi's maintainers. */
  reviewed: boolean;
  /** Where its source is, pinned. */
  source: { url: string; commit: string };
  icon?: string;
  screenshots: string[];
  /** Newest first. */
  versions: IndexVersion[];
  pulled: PulledVersion[];
}

/**
 * An entry this Dashi can't read (a permission or a field it doesn't know, or
 * a mistake): left out of the list and never installable. What little reads
 * is kept: its id, for the log and the store's count, and its pulled
 * versions, so the kill switch still reaches a copy that is installed.
 */
export interface SkippedApplet {
  /** The id its manifest names, when that much reads; null otherwise. */
  id: string | null;
  /** Why, in the parser's words (for the log). */
  reason: string;
  pulled: PulledVersion[];
}

export interface PulledVersion {
  version: string;
  reason: string;
}

export interface CatalogIndex {
  format: number;
  generated: string;
  applets: IndexApplet[];
  /** The entries left out, in the index's order. */
  skipped: SkippedApplet[];
}

const HTTPS = /^https:\/\/[^\s"<>]+$/;
const url = (value: unknown, what: string): string | Refusal =>
  typeof value === "string" && HTTPS.test(value) ? value : refuse(`${what} must be an https address`);

function parseVersion(value: unknown, where: string): IndexVersion | Refusal {
  const fields = record(value, where, ["version", "dashi", "url", "sha256", "size", "signature", "released", "notes"]);
  if (isRefusal(fields)) return fields;
  const version = text(fields.version, `${where}: version`, 40);
  if (isRefusal(version)) return version;
  const dashi = text(fields.dashi, `${where}: dashi`, 20);
  if (isRefusal(dashi)) return dashi;
  // A package may be a local file too: only a test catalog, signed with its own key, lists one.
  const address = typeof fields.url === "string" && /^file:\/\/\/[^\s"<>]+$/.test(fields.url) ? fields.url : url(fields.url, `${where}: url`);
  if (isRefusal(address)) return address;
  if (typeof fields.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(fields.sha256)) return refuse(`${where}: sha256 must be 64 hex digits`);
  if (typeof fields.size !== "number" || !Number.isInteger(fields.size) || fields.size <= 0 || fields.size > 64 * 1024 * 1024)
    return refuse(`${where}: size is wrong`);
  if (typeof fields.signature !== "string" || fields.signature.length > 1024) return refuse(`${where}: signature must be a minisig`);
  if (typeof fields.released !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fields.released)) return refuse(`${where}: released must be YYYY-MM-DD`);
  const notes = optionalText(fields.notes, `${where}: notes`, 2000);
  if (isRefusal(notes)) return notes;
  return {
    version,
    dashi,
    url: address,
    sha256: fields.sha256,
    size: fields.size,
    signature: fields.signature,
    released: fields.released,
    ...(notes === undefined ? {} : { notes }),
  };
}

function parsePulled(value: unknown, where: string): PulledVersion[] | Refusal {
  return list(value ?? [], `${where}: pulled`, 100, (entry, at) => {
    const pull = record(entry, at, ["version", "reason"]);
    if (isRefusal(pull)) return pull;
    const version = text(pull.version, `${at}: version`, 40);
    if (isRefusal(version)) return version;
    const reason = text(pull.reason, `${at}: reason`, 200);
    return isRefusal(reason) ? reason : { version, reason };
  });
}

/** What can be read of an entry that doesn't parse: the id its manifest names, and its pulled list. */
function skippedApplet(value: unknown, reason: string): SkippedApplet {
  const fields = isRecord(value) ? value : {};
  const manifest = fields.manifest;
  const raw = isRecord(manifest) ? manifest.id : undefined;
  const pulled = parsePulled(fields.pulled, "pulled");
  return { id: isAppletId(raw) ? raw : null, reason, pulled: isRefusal(pulled) ? [] : pulled };
}

function parseIndexApplet(value: unknown, where: string): IndexApplet | Refusal {
  const fields = record(value, where, ["manifest", "authorKey", "reviewed", "source", "icon", "screenshots", "versions", "pulled"]);
  if (isRefusal(fields)) return fields;
  const manifest = parseManifest(fields.manifest);
  if (isRefusal(manifest)) return refuse(`${where}: ${manifest.error}`);
  if (typeof fields.authorKey !== "string" || !parsePublicKey(fields.authorKey)) return refuse(`${where}: authorKey is not a minisign public key`);
  const reviewed = optionalBoolean(fields.reviewed, `${where}: reviewed`);
  if (isRefusal(reviewed)) return reviewed;
  const source = record(fields.source, `${where}: source`, ["url", "commit"]);
  if (isRefusal(source)) return source;
  const sourceUrl = url(source.url, `${where}: source.url`);
  if (isRefusal(sourceUrl)) return sourceUrl;
  if (typeof source.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(source.commit)) return refuse(`${where}: source.commit must be a commit hash`);
  const icon = fields.icon === undefined ? undefined : url(fields.icon, `${where}: icon`);
  if (isRefusal(icon)) return icon;
  const screenshots = list(fields.screenshots ?? [], `${where}: screenshots`, 8, url);
  if (isRefusal(screenshots)) return screenshots;
  const versions = list(fields.versions, `${where}: versions`, 100, parseVersion);
  if (isRefusal(versions)) return versions;
  if (versions.length === 0) return refuse(`${where} has no versions`);
  const pulled = parsePulled(fields.pulled, where);
  if (isRefusal(pulled)) return pulled;
  return {
    manifest,
    authorKey: fields.authorKey,
    reviewed: reviewed ?? false,
    source: { url: sourceUrl, commit: source.commit },
    ...(icon === undefined ? {} : { icon }),
    screenshots,
    versions: [...versions].sort((a, b) => compareVersions(b.version, a.version)),
    pulled,
  };
}

export function parseIndex(value: unknown): CatalogIndex | Refusal {
  const fields = record(value, "the index", ["format", "generated", "applets"]);
  if (isRefusal(fields)) return fields;
  if (fields.format !== INDEX_FORMAT) return refuse(`the index is format ${String(fields.format)}; this Dashi reads format ${INDEX_FORMAT}`);
  if (typeof fields.generated !== "string") return refuse("the index has no date");
  // Entry by entry: one this Dashi can't read is skipped (and says why), and the rest are listed.
  const entries = list(fields.applets, "applets", 2000, (entry, where) => ({ entry, parsed: parseIndexApplet(entry, where) }));
  if (isRefusal(entries)) return entries;
  const read = entries.map(({ entry, parsed }) => (isRefusal(parsed) ? skippedApplet(entry, parsed.error) : parsed));
  // An id listed twice is neither one: which to believe isn't Dashi's to guess.
  const idOf = (each: IndexApplet | SkippedApplet): string | null => ("manifest" in each ? each.manifest.id : each.id);
  const twice = new Set(read.map(idOf).filter((id, at, all): id is string => id !== null && all.indexOf(id) !== at));
  const applets: IndexApplet[] = [];
  const skipped: SkippedApplet[] = [];
  for (const each of read) {
    const id = idOf(each);
    if (!("manifest" in each)) skipped.push(each);
    else if (id !== null && twice.has(id)) skipped.push({ id, reason: `the index lists ${id} twice`, pulled: each.pulled });
    else applets.push(each);
  }
  return { format: INDEX_FORMAT, generated: fields.generated, applets, skipped };
}

/** The index's bytes and its catalog's signature on them → the index, or why not. */
export function verifyIndex(bytes: Uint8Array, signature: string, catalogKey: string): CatalogIndex | Refusal {
  const checked = verify(bytes, signature, catalogKey);
  if (!checked.ok) return refuse(`the index isn't signed by its catalog's key: ${checked.reason}`);
  try {
    return parseIndex(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return refuse("the index is not JSON");
  }
}

export const isPulled = (applet: IndexApplet, version: string): boolean => applet.pulled.some((pull) => pull.version === version);

/** The newest version this Dashi runs that isn't pulled; null when none is. */
export function installable(applet: IndexApplet, dashiVersion: string): IndexVersion | null {
  return applet.versions.find((each) => !isPulled(applet, each.version) && dashiSatisfies(each.dashi, dashiVersion)) ?? null;
}

/**
 * A downloaded package against the index: size, sha256, the author's
 * signature, and (for an update) the key the installed version was signed by.
 */
export function verifyPackage(bytes: Uint8Array, applet: IndexApplet, version: IndexVersion, installedKey?: string): true | Refusal {
  const id = applet.manifest.id;
  if (isPulled(applet, version.version)) return refuse(`${id} ${version.version} was pulled from the catalog`);
  if (bytes.byteLength !== version.size) return refuse(`${id} ${version.version} is not the size the index lists`);
  if (sha256(bytes) !== version.sha256) return refuse(`${id} ${version.version} doesn't match the index (sha256)`);
  if (installedKey !== undefined && installedKey !== applet.authorKey) return refuse(`${id}'s update is signed by a different key than the installed version`);
  const checked = verify(bytes, version.signature, applet.authorKey);
  if (!checked.ok) return refuse(`${id} ${version.version}: ${checked.reason}`);
  return true;
}

/** The trusted comment `dashi-applet pack --sign` and CI write: names what was signed. */
export const trustedComment = (manifest: Pick<Manifest, "id" | "version">, digest: string): string =>
  `dashi-applet ${manifest.id} ${manifest.version} sha256:${digest}`;
