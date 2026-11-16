/**
 * Search over the catalog, in memory: every word must match. Apps match on
 * name, summary, keywords, developer and package names; a command-line tool
 * only on its package name (so "video" doesn't bring 300 libraries, and
 * "ripgrep" or "htop" finds the tool). Order: exact name, name prefix,
 * installed, a name that holds the word, then the rest; Flathub's verified
 * apps before others on a tie. Pure.
 */

import type { CatalogEntry, SearchResult } from "../catalog-types.ts";

export const words = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, 8);

function appScore(entry: CatalogEntry, terms: readonly string[], phrase: string): number {
  const name = entry.name.toLowerCase();
  const refs = entry.offers.map((offer) => offer.ref.toLowerCase());
  const rest = `${entry.summary} ${entry.keywords.join(" ")} ${entry.developer ?? ""}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (name.includes(term) || refs.some((ref) => ref.includes(term))) score += 10;
    else if (rest.includes(term)) score += 3;
    else return 0;
  }
  if (name === phrase || refs.includes(phrase)) score += 100;
  else if (name.split(/\s+/).includes(phrase)) score += 60;
  else if (name.startsWith(phrase)) score += 50;
  if (entry.offers.some((offer) => offer.installed)) score += 20;
  if (entry.offers[0]?.verified) score += 2;
  return score;
}

function toolScore(entry: CatalogEntry, terms: readonly string[], phrase: string): number {
  const name = entry.name.toLowerCase();
  if (!terms.every((term) => name.includes(term))) return 0;
  if (name === phrase || name === terms.join("-")) return 100;
  if (name.startsWith(phrase) || name.startsWith(terms.join("-"))) return 60 - Math.min(name.length, 40) / 2;
  // A word inside a longer name ("rg" in "fedora-rg-something") is too loose for tools: only a whole part counts.
  return name.split(/[-_.]/).some((part) => terms.includes(part)) ? 20 : 0;
}

/** At most `limit` apps and `limit` tools for what was typed, best first. */
export function searchCatalog(entries: readonly CatalogEntry[], query: string, limit = 24): SearchResult {
  const terms = words(query);
  if (terms.length === 0) return { apps: [], tools: [] };
  const phrase = terms.join(" ");
  const apps: Array<{ entry: CatalogEntry; score: number }> = [];
  const tools: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of entries) {
    const score = entry.kind === "app" ? appScore(entry, terms, phrase) : toolScore(entry, terms, phrase);
    if (score > 0) (entry.kind === "app" ? apps : tools).push({ entry, score });
  }
  const best = (list: typeof apps): CatalogEntry[] =>
    list
      .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name))
      .slice(0, limit)
      .map((each) => each.entry);
  return { apps: best(apps), tools: best(tools) };
}
