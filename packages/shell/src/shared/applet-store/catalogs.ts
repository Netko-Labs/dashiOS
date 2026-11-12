/**
 * The applet catalogs Software reads: Dashi's, built in and always first,
 * and the ones the person added (a team's, a fork, their own), kept in the
 * settings file as `applets.catalogs: [{name, url, key}]`. Everything here
 * is pure: what a catalog is, how the saved list is read (as untrusted, entry
 * by entry), the hosts each catalog's files may come from, and the words for
 * a catalog that doesn't check. Loading them is catalog-set.ts's.
 *
 * A catalog's `url` is its index.json, https (or file:// for tests and
 * checks); `key` its minisign public key's line. Its packages, icons and
 * screenshots come from CATALOG_HOSTS or the index's own host, https only.
 */

import { isCatalogAddress, parsePublicKey, publicKeyLine } from "@dashi/applet";
import { isRecord } from "@dashi/shape";
import { httpsUrl } from "../software/parse-values.ts";
import { DEFAULT_INDEX, hostsFor } from "./catalog.ts";
import { DASHI_INDEX_KEY } from "./keys.ts";

/** What the settings file keeps for one added catalog. */
export interface CatalogSetting {
  name: string;
  url: string;
  /** The minisign public key's base64 line. */
  key: string;
}

/** A catalog the store reads: Dashi's (built in) or one the person added. */
export interface CatalogSource {
  name: string;
  url: string;
  /** Null only for Dashi's, while this build has no key for it. */
  key: string | null;
  builtIn: boolean;
}

/** Which catalog an applet in the store came from (what a row and a page say). */
export type CatalogRef = Pick<CatalogSource, "name" | "url" | "builtIn">;

export const DASHI_CATALOG_NAME = "Dashi";
export const MAX_CATALOGS = 16;
export const MAX_CATALOG_NAME = 40;

/** Dashi's own catalog: `DASHI_APPLETS_INDEX` and `DASHI_APPLETS_KEY` (catalog.ts `keyFrom`) stand in for a test one. */
export function dashiCatalog(env: Readonly<Record<string, string | undefined>>, key: string | null = DASHI_INDEX_KEY): CatalogSource {
  return { name: DASHI_CATALOG_NAME, url: env.DASHI_APPLETS_INDEX ?? DEFAULT_INDEX, key, builtIn: true };
}

/** A minisign public key, as a .pub file's text or its bare line → the line; null when it isn't one. */
export function keyLineOf(text: string): string | null {
  if (text.length > 4096) return null;
  const key = parsePublicKey(text.trim());
  return key ? publicKeyLine(key) : null;
}

const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= MAX_CATALOG_NAME && !/[\p{Cc}]/u.test(value);

/** The host of an https address; null otherwise. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.hostname : null;
  } catch {
    return null;
  }
}

/** Whether `url` can be a catalog's index: https (no user, password or port), or a local file. */
export const isIndexAddress = (url: string): boolean => isCatalogAddress(url) && (url.startsWith("file:///") || httpsUrl(url, [hostOf(url) ?? ""]) !== null);

/** Whether `url` (a package, an icon, a screenshot) may be fetched for the catalog at `indexUrl`: https on its hosts, or a file when the catalog is one. */
export function allowedFor(indexUrl: string, url: string): boolean {
  if (url.startsWith("file:///")) return indexUrl.startsWith("file:///");
  return httpsUrl(url, hostsFor(indexUrl)) !== null;
}

/** One saved entry → the catalog, or why not. */
function parseEntry(value: unknown, at: string): CatalogSetting | string {
  if (!isRecord(value)) return `${at} must be an object`;
  const fields = value;
  for (const key of Object.keys(fields)) if (!["name", "url", "key"].includes(key)) return `${at}.${key} means nothing`;
  if (!isName(fields.name)) return `${at}.name must be a name of 1 to ${MAX_CATALOG_NAME} characters`;
  if (typeof fields.url !== "string" || !isIndexAddress(fields.url)) return `${at}.url must be an https (or file://) address`;
  const key = typeof fields.key === "string" ? keyLineOf(fields.key) : null;
  if (key === null) return `${at}.key must be a minisign public key`;
  return { name: fields.name, url: fields.url, key };
}

/**
 * `applets.catalogs` as read from the file: each good entry, in order; a bad
 * one, a second one with the same address, Dashi's own address, and any past
 * the 16th are left out and said why (for the log).
 */
export function parseCatalogs(value: unknown, dashiUrl: string = DEFAULT_INDEX): { catalogs: CatalogSetting[]; problems: string[] } {
  const problems: string[] = [];
  if (value === undefined) return { catalogs: [], problems };
  if (!Array.isArray(value)) return { catalogs: [], problems: ["applets.catalogs must be a list"] };
  const catalogs: CatalogSetting[] = [];
  const seen = new Set([dashiUrl]);
  for (const [index, entry] of value.entries()) {
    const at = `applets.catalogs[${index}]`;
    const parsed = parseEntry(entry, at);
    if (typeof parsed === "string") problems.push(parsed);
    else if (seen.has(parsed.url)) problems.push(`${at} is a catalog already listed`);
    else if (catalogs.length >= MAX_CATALOGS) problems.push(`${at}: at most ${MAX_CATALOGS} catalogs`);
    else {
      seen.add(parsed.url);
      catalogs.push(parsed);
    }
  }
  return { catalogs, problems };
}

/** Whether `value` is a list the settings store may write: every entry good, no address twice. */
export function isCatalogList(value: unknown): value is CatalogSetting[] {
  if (!Array.isArray(value) || value.length > MAX_CATALOGS) return false;
  const { catalogs, problems } = parseCatalogs(value, "");
  return (
    problems.length === 0 &&
    catalogs.every((each, index) => {
      const raw: unknown = value[index];
      return isRecord(raw) && raw.key === each.key;
    })
  );
}

/** Every catalog the store reads: Dashi's first, then the added ones in the order they were added. */
export function catalogSources(dashi: CatalogSource, saved: readonly CatalogSetting[]): CatalogSource[] {
  return [dashi, ...saved.filter((each) => each.url !== dashi.url).map((each) => ({ ...each, builtIn: false }))];
}

/** What is typed in the Add Catalog sheet. */
export interface CatalogDraft {
  name: string;
  url: string;
  key: string;
}

/** The draft as a catalog to check, or why not, in people's words. */
export function checkDraft(draft: CatalogDraft, existing: readonly CatalogSource[]): CatalogSetting | { error: string } {
  const name = draft.name.trim();
  const url = draft.url.trim();
  if (name === "") return { error: "Give the catalog a name." };
  if (!isName(name)) return { error: `A catalog’s name can be at most ${MAX_CATALOG_NAME} characters.` };
  if (!isIndexAddress(url)) return { error: "The index address must start with https:// and point at the catalog’s index.json." };
  if (existing.some((each) => each.url === url)) return { error: "That catalog is already in the list." };
  if (existing.filter((each) => !each.builtIn).length >= MAX_CATALOGS) return { error: `Dashi keeps at most ${MAX_CATALOGS} catalogs. Remove one first.` };
  const key = keyLineOf(draft.key);
  if (key === null) return { error: "That isn’t a public key. Paste the catalog’s .pub file, or the line of letters in it." };
  if (existing.some((each) => each.name.toLowerCase() === name.toLowerCase())) return { error: "Another catalog already has that name." };
  return { name, url, key };
}

/** Why a catalog didn't load, in people's words (never the parser's text). */
export function catalogProblemWords(kind: "offline" | "unsigned" | "no-key" | "other"): string {
  switch (kind) {
    case "offline":
      return "Dashi couldn’t reach that address. Check it, and the network, and try again.";
    case "unsigned":
      return "That catalog isn’t signed with this key, so Dashi won’t trust it. Check the public key you were given.";
    case "no-key":
      return "There is no key to check this catalog with.";
    case "other":
      return "There’s no applet catalog at that address.";
  }
}
