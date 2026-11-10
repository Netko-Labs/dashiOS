/**
 * The ranking's index (rank.ts): every item's names, keywords, intents and
 * qualifiers folded once, with the letter masks a keystroke tests first.
 * Built once per set of items and read-only after that.
 */

import { charMask, type Folded, prepare } from "./fold.ts";
import { INTENTS, type Intents } from "./intents.ts";
import { RANK_KINDS, type RankItem } from "./item.ts";

export interface Prepared<T extends RankItem> {
  item: T;
  names: Folded[];
  keywords: Folded[];
  /** Keywords that answer only when nothing else matches (a pane's "settings"). */
  fallback: Folded[];
  /** Folded intent phrases that mean this item. */
  intents: string[];
  /** Every letter it has, over all of the above. */
  mask: number;
  /** Every letter a word of it starts with. */
  startMask: number;
  demoted: boolean;
  /** Its tie bonus from kind and ownership, 0–8. */
  bonus: number;
  /** Its first name, folded, for the last tie-break. */
  sortName: string;
  /** Folded words of its qualifiers (RankItem.qualifiers), one by one. */
  qualifiers: string[];
}

export interface RankIndex<T extends RankItem> {
  readonly prepared: readonly Prepared<T>[];
}

/** Prepare `items` for ranking: their words folded, the intents attached. */
export function buildIndex<T extends RankItem>(items: readonly T[], intents: Intents = INTENTS): RankIndex<T> {
  const phrases = new Map<string, string[]>();
  for (const intent of intents.intents) {
    const folded = intent.phrases.map((phrase) => prepare(phrase).text).filter(Boolean);
    phrases.set(intent.id, [...(phrases.get(intent.id) ?? []), ...folded]);
  }
  const demoted = new Set(intents.demoted);
  const prepared = items.map((item): Prepared<T> => {
    const fallbackWords = new Set([...(intents.fallback[item.kind] ?? []), ...(item.fallback ?? [])].map((word) => prepare(word).text));
    const isDemoted = demoted.has(item.id);
    const names = unique(item.names.map(prepare));
    // A demoted item answers to its name and its intents only, not to its keywords.
    const words = isDemoted
      ? []
      : unique([...(item.keywords ?? []), ...(item.fallback ?? [])].map(prepare)).filter((word) => !names.some((name) => name.text === word.text));
    const keywords = words.filter((word) => !fallbackWords.has(word.text));
    const fallback = words.filter((word) => fallbackWords.has(word.text));
    const own = phrases.get(item.id) ?? [];
    let mask = 0;
    let startMask = 0;
    for (const each of [...names, ...keywords, ...fallback]) {
      mask |= each.mask;
      startMask |= each.startMask;
    }
    for (const phrase of own) {
      mask |= charMask(phrase);
      startMask |= charMask(phrase.slice(0, 1));
    }
    return {
      item,
      names,
      keywords,
      fallback,
      intents: own,
      mask,
      startMask,
      demoted: isDemoted,
      bonus: RANK_KINDS.length - RANK_KINDS.indexOf(item.kind) + (item.own ? 1 : 0),
      sortName: names[0]?.text ?? "",
      qualifiers: [
        ...new Set(
          (item.qualifiers ?? [])
            .flatMap((each) =>
              each
                .trim()
                .split(/\s+/)
                .map((word) => prepare(word).text),
            )
            .filter(Boolean),
        ),
      ],
    };
  });
  return { prepared };
}

const unique = (words: Folded[]): Folded[] => {
  const seen = new Set<string>();
  return words.filter((word) => word.text !== "" && !seen.has(word.text) && seen.add(word.text));
};
