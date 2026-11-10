/**
 * The launcher's entries (entries.ts) as ranking items: an installed app
 * with its localized name and keywords, a Settings pane with Dashi's words
 * for it in the person's language. `rankEntries` answers like today's
 * the old `search()` did, for anyone who wants entries back.
 */

import { SETTINGS_APP_ID } from "../../apps.ts";
import type { Entry } from "../../entries.ts";
import { languagesOf, messageLocales } from "../../shared/locale/index.ts";
import type { RankItem, RankSignals } from "./item.ts";
import { dashiWords } from "./lib/words.ts";
import { rank } from "./rank.ts";
import { buildIndex, type RankIndex } from "./rank-index.ts";

export interface EntryItem extends RankItem {
  entry: Entry;
}

/** `entry` as an item, its words in `languages` (languagesOf) added to its own. */
export function entryItem(entry: Entry, languages: readonly string[]): EntryItem {
  const { localized } = entry;
  return {
    id: entry.id,
    kind: entry.id.startsWith(`${SETTINGS_APP_ID}/`) ? "pane" : "app",
    // The person's name for it first, the default one still matching.
    names: [...(localized?.name ? [localized.name] : []), entry.name],
    keywords: [
      ...entry.keywords,
      ...(localized?.keywords ?? []),
      ...(localized?.genericName ? [localized.genericName] : []),
      ...dashiWords(entry.id, languages),
    ],
    ...(entry.fallbackKeywords ? { fallback: entry.fallbackKeywords } : {}),
    ...(entry.shell ? { own: true } : {}),
    entry,
  };
}

/** The index over `entries`, in the language of `env`. Build it when the entries change, not per keystroke. */
export function entryIndex(entries: readonly Entry[], env: Readonly<Record<string, string | undefined>> = process.env): RankIndex<EntryItem> {
  const languages = languagesOf(messageLocales(env));
  return buildIndex(entries.filter((entry) => !entry.hidden).map((entry) => entryItem(entry, languages)));
}

/** The entries matching `query`, best first. */
export function rankEntries(index: RankIndex<EntryItem>, query: string, signals?: RankSignals, limit = 7): Entry[] {
  return rank(index, query, { limit, ...(signals ? { signals } : {}) }).map((result) => result.item.entry);
}
