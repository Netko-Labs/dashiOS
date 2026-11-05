/**
 * The ranking (betterments.html, "Ranking and keys", recommendation B).
 * Match quality decides first (match.ts's tiers); what was picked for this
 * query, or for one it begins, promotes an item past a tier or two; how
 * often and how lately something was opened, from anywhere, then breaks the
 * ties, before the kind and the name. An exact name is never outranked by
 * anything that isn't one. The index is built once per set of items and is
 * read-only: a keystroke allocates almost nothing and touches each item once,
 * most of them only for a bit mask.
 */

import { bitCount, charMask, type Folded, prepare } from "./fold.ts";
import { INTENTS, type Intents } from "./intents.ts";
import { RANK_KINDS, type RankItem, type RankSignals } from "./item.ts";
import { type Hit, type MatchKind, matchKeyword, matchName, matchTypo, TIER } from "./match.ts";

interface Prepared<T extends RankItem> {
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

export interface RankResult<T extends RankItem> {
  item: T;
  score: number;
  /** How it matched: the launcher says "Did you mean …?" for a typo. */
  match: MatchKind;
}

export interface RankOptions {
  signals?: RankSignals;
  /** How many results; all of them when left out. */
  limit?: number;
}

const BAND = 100;
/** What one pick for this query adds, and the most picks count for. */
const PICK = 150;
const MOST_PICKS = 2;
/** The most frecency adds: under a band, so it only orders a tier. */
const FRECENCY = 40;
/** Opened this many times (decayed) earns half of FRECENCY. */
const FRECENCY_HALF = 4;
const EXACT_FLOOR = TIER.exact * BAND;
const DEMOTE = (TIER.exact + 1) * BAND;
/**
 * What anything but an app gives up in its tier when it is not clearly the
 * match (a part of its name, not the whole of it or of a keyword): an app
 * matching as well comes first ("no" is Notes, not Notifications; "s" is an
 * app, not Sleep; "a" Activity Monitor, not About). A Settings pane gives up
 * the most, so a setting or command still beats it. Less than a band, so
 * nothing drops a tier.
 */
const YIELD = 30;
const PANE_YIELD = 50;
const NO_PICKS: ReadonlyMap<string, number> = new Map();

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

const better = (a: Hit | null, b: Hit | null): Hit | null => {
  if (!a) return b;
  if (!b) return a;
  const difference = TIER[a.kind] - TIER[b.kind];
  return difference > 0 || (difference === 0 && a.close >= b.close) ? a : b;
};

/** A query as the matchers need it. */
interface Query {
  text: string;
  mask: number;
  /** The bits of its first letter, and of its first two (a typo may swap them). */
  first: number;
  firstTwo: number;
  /** Four letters or more: a substring inside a word and a typo count, so it needn't start a word. */
  long: boolean;
}

/** Whether `target` can match `query` at all, but for a typo: it has every letter, and a word starting with the first. */
const fits = (query: Query, target: Folded): boolean => (query.mask & ~target.mask) === 0 && (query.long || (query.first & target.startMask) !== 0);

/** Whether `target` can be one typo from `query`: one letter missing at most, and a word starting with its first or second. */
const mayTypo = (query: Query, target: Folded): boolean => (query.firstTwo & target.startMask) !== 0 && bitCount(query.mask & ~target.mask) <= 1;

/** The best way `query` matches `entry`, or null; `missing` is how many of its letters the entry lacks. */
function bestHit<T extends RankItem>(entry: Prepared<T>, query: Query, missing: number): Hit | null {
  const q = query.text;
  let best: Hit | null = null;
  if (missing === 0) {
    let name: Hit | null = null;
    for (const each of entry.names) if (fits(query, each)) name = better(name, matchName(q, each));
    if (name?.kind === "exact") return name;
    for (const phrase of entry.intents) {
      if (phrase === q) return { kind: "intent", close: 39 };
      if (q.length >= 3 && phrase.startsWith(q)) best = better(best, { kind: "keywordPart", close: 20 });
    }
    for (const keyword of entry.keywords) if (fits(query, keyword)) best = better(best, matchKeyword(q, keyword));
    // A keyword that wins over the name still owes something to how the name matched: "text" is
    // a keyword of Messages and of Text Editor, and Text Editor's name starts with it.
    if (best && TIER[best.kind] > TIER[name?.kind ?? "keywordTypo"]) {
      return { kind: best.kind, close: best.close * 0.8 + (name ? (8 * TIER[name.kind]) / TIER.exact : 0) };
    }
    best = better(best, name);
  }
  if (best || !query.long || (query.firstTwo & entry.startMask) === 0) return best;
  for (const name of entry.names) if (mayTypo(query, name)) best = better(best, matchTypo(q, name, "typo"));
  if (best) return best;
  for (const keyword of entry.keywords) if (mayTypo(query, keyword)) best = better(best, matchTypo(q, keyword, "keywordTypo"));
  return best;
}

/** `query`'s matches in `index`, best first. */
const queryOf = (text: string): Query => ({
  text,
  mask: charMask(text),
  first: charMask(text.slice(0, 1)),
  firstTwo: charMask(text.slice(0, 2)),
  long: text.length >= 4,
});

/**
 * `words` without the ones that begin one of `qualifiers`, or null unless at
 * least one went and one is left: a qualifier narrows, it never finds alone.
 */
function withoutQualifiers(words: readonly string[], qualifiers: readonly string[]): string | null {
  const rest = words.filter((word) => !qualifiers.some((qualifier) => qualifier.startsWith(word)));
  return rest.length > 0 && rest.length < words.length ? rest.join(" ") : null;
}

/** How `entry` matches what is left of the query once its qualifiers are taken out, or null. */
function qualifiedHit<T extends RankItem>(entry: Prepared<T>, words: readonly string[]): Hit | null {
  const rest = withoutQualifiers(words, entry.qualifiers);
  if (rest === null) return null;
  const rq = queryOf(rest);
  if (bitCount(rq.mask & ~entry.mask) !== 0 || (!rq.long && (rq.first & entry.startMask) === 0)) return null;
  return bestHit(entry, rq, 0);
}

export function rank<T extends RankItem>(index: RankIndex<T>, query: string, options: RankOptions = {}): RankResult<T>[] {
  const text = prepare(query).text;
  if (!text) return [];
  const q = queryOf(text);
  // Folding joins the words ("view sort" is "viewsort"): a qualifier needs them apart.
  const spaced = query.trim().split(/\s+/);
  const words = spaced.length > 1 ? spaced.map((word) => prepare(word).text).filter(Boolean) : null;
  const tolerance = q.long ? 1 : 0;
  const { signals } = options;
  const picks = signals?.picks(text) ?? NO_PICKS;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const strong: Ranked<T>[] = [];
  const weak: Ranked<T>[] = [];
  for (const entry of index.prepared) {
    let hit: Hit | null = null;
    let list = strong;
    const missing = bitCount(q.mask & ~entry.mask);
    if ((q.long || (q.first & entry.startMask) !== 0) && missing <= tolerance) {
      hit = bestHit(entry, q, missing);
      if (!hit && missing === 0) {
        for (const keyword of entry.fallback) if (fits(q, keyword)) hit = better(hit, matchKeyword(text, keyword));
        list = weak;
      }
    }
    if (!hit && words && entry.qualifiers.length > 0) {
      hit = qualifiedHit(entry, words);
      list = strong;
    }
    if (!hit) continue;
    keep(list, { item: entry.item, match: hit.kind, score: score(entry, hit, picks, signals), sortName: entry.sortName }, limit);
  }
  const results = strong.length > 0 ? strong : weak;
  if (limit === Number.POSITIVE_INFINITY) results.sort(order);
  return results.map(({ item, score, match }) => ({ item, score, match }));
}

type Ranked<T extends RankItem> = RankResult<T> & { sortName: string };

/** Best first: the score, then the name, then the id, so equal scores always come out the same. */
const order = <T extends RankItem>(a: Ranked<T>, b: Ranked<T>): number =>
  b.score - a.score || (a.sortName < b.sortName ? -1 : a.sortName > b.sortName ? 1 : 0) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

/** Add `result` to `list`; with a limit, the list stays sorted and only the best `limit` are kept, so a keystroke sorts a handful, not thousands. */
function keep<T extends RankItem>(list: Ranked<T>[], result: Ranked<T>, limit: number): void {
  if (limit === Number.POSITIVE_INFINITY) {
    list.push(result);
    return;
  }
  if (limit <= 0) return;
  const last = list[list.length - 1];
  if (list.length >= limit && last && order(result, last) >= 0) return;
  let at = list.length;
  while (at > 0 && order(result, list[at - 1] as Ranked<T>) < 0) at--;
  list.splice(at, 0, result);
  if (list.length > limit) list.pop();
}

function score<T extends RankItem>(entry: Prepared<T>, hit: Hit, picks: ReadonlyMap<string, number>, signals: RankSignals | undefined): number {
  const { item } = entry;
  let value = TIER[hit.kind] * BAND + hit.close + entry.bonus;
  if (item.kind !== "app" && TIER[hit.kind] < TIER.keyword) value -= item.kind === "pane" ? PANE_YIELD : YIELD;
  if (signals) {
    const opened = signals.frecency(item.id);
    if (opened > 0) value += (FRECENCY * opened) / (opened + FRECENCY_HALF);
  }
  const picked = picks.get(item.id) ?? 0;
  value += PICK * Math.min(MOST_PICKS, picked);
  // Only an exact name reaches the exact band, and never a name another program chose.
  if ((hit.kind !== "exact" || item.foreign) && value >= EXACT_FLOOR) value = EXACT_FLOOR - 1 + value / 1e6;
  if (entry.demoted && hit.kind !== "intent") value -= DEMOTE;
  return value;
}
