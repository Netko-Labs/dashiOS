/**
 * How well a query matches one name or keyword, as a tier and a closeness.
 * Tiers decide (an exact name beats a prefix, a prefix beats a word start,
 * and so on down to a typo); closeness only orders matches inside a tier.
 * A bare substring inside a word counts only from four letters on, so "ter"
 * doesn't find Battery; a fuzzy match has to start at a word start.
 */

import type { Folded } from "./fold.ts";

/** The kinds of match, best first. A higher tier always ranks above a lower one. */
export const TIER = {
  /** The whole name ("firefox" for Firefox). */
  exact: 12,
  /** A word the item stands for ("preferences" for System Settings), from the intents. */
  intent: 11,
  /** A whole keyword ("browser" for Firefox). */
  keyword: 10,
  /** The start of the name ("fire"). */
  prefix: 9,
  /** The start of a later word of the name ("set" in System Settings). */
  word: 8,
  /** The first letters of its words ("ss" for System Settings). */
  acronym: 7,
  /** The start of a keyword or of one of its words ("mode" in "dark mode"), or a keyword's initials. */
  keywordPart: 6,
  /** Inside a word of the name, four letters or more ("tery" in Battery). */
  inside: 5,
  /** The query's letters in order, from word starts ("msg" for Messages, "tedit" for Text Editor). */
  fuzzy: 4,
  /** Inside a keyword, or its letters in order. */
  keywordLoose: 3,
  /** The name, one typo away, from four letters ("fierfox" for Firefox). */
  typo: 2,
  /** A keyword, one typo away. */
  keywordTypo: 1,
} as const;

export type MatchKind = keyof typeof TIER;

export interface Hit {
  kind: MatchKind;
  /** Order inside the tier, 0–39: how much of the target the query covers, how early it starts. */
  close: number;
}

const CLOSE = 39;
/** Below this many letters a gap inside a word is no match; the fuzzy scorer only looks from three. */
const GAPS_FROM = 4;
const FUZZY_FROM = 3;
const INSIDE_FROM = 4;
/** The longest target the fuzzy scorer reads; anything after is ignored. */
const FUZZY_MAX = 128;

const cover = (query: string, target: string): number => (CLOSE * query.length) / Math.max(target.length, 1);

/** Where a later word of `target` starts with `query`, or -1. */
function wordStartAt(query: string, target: Folded): number {
  const { text, starts } = target;
  for (let i = 1; i <= text.length - query.length; i++) if (starts[i] === 1 && text.startsWith(query, i)) return i;
  return -1;
}

/** `query` against a name. */
export function matchName(query: string, target: Folded): Hit | null {
  const { text } = target;
  if (text === query) return { kind: "exact", close: CLOSE };
  if (text.startsWith(query)) return { kind: "prefix", close: cover(query, text) };
  const at = wordStartAt(query, target);
  // A word nearer the front is closer: "set" is better in "System Settings" than in "Display Night Setup".
  if (at > 0) return { kind: "word", close: Math.max(0, CLOSE - 4 * (target.word[at] ?? 0)) * (0.5 + 0.5 * (query.length / text.length)) };
  if (query.length >= 2 && target.initials.startsWith(query)) return { kind: "acronym", close: cover(query, target.initials) };
  if (query.length >= INSIDE_FROM && text.includes(query)) return { kind: "inside", close: cover(query, text) };
  const fuzzy = fuzzyScore(query, target);
  return fuzzy === null ? null : { kind: "fuzzy", close: fuzzy };
}

/** `query` against a keyword. */
export function matchKeyword(query: string, target: Folded): Hit | null {
  const { text } = target;
  if (text === query) return { kind: "keyword", close: CLOSE };
  if (text.startsWith(query)) return { kind: "keywordPart", close: cover(query, text) };
  if (wordStartAt(query, target) > 0 || (query.length >= 2 && target.words.length > 1 && target.initials.startsWith(query))) {
    return { kind: "keywordPart", close: cover(query, text) / 2 };
  }
  if (query.length >= INSIDE_FROM && text.includes(query)) return { kind: "keywordLoose", close: cover(query, text) };
  const fuzzy = fuzzyScore(query, target);
  return fuzzy === null ? null : { kind: "keywordLoose", close: fuzzy / 2 };
}

/** `query` one typo from a word of `target` or from its start, for queries of four letters or more. */
export function matchTypo(query: string, target: Folded, kind: "typo" | "keywordTypo"): Hit | null {
  if (query.length < GAPS_FROM) return null;
  let best: Hit | null = null;
  const q0 = query.charCodeAt(0);
  const q1 = query.charCodeAt(1);
  for (const word of target.typoWords) {
    // A typo in the first letter is rare and matches too much: the first letter (or the first two, swapped) holds.
    const w0 = word.charCodeAt(0);
    if (w0 !== q0 && !(w0 === q1 && word.charCodeAt(1) === q0)) continue;
    if (word.length + 1 < query.length) continue;
    if (withinOneEdit(query, word)) return { kind, close: CLOSE * 0.75 };
    if (best) continue;
    // Or one typo from its start, while the rest is still to be typed ("fier" for Firefox).
    for (let length = Math.max(3, query.length - 1); length <= query.length + 1 && length < word.length; length++) {
      if (withinOneEdit(query, word, length)) {
        best = { kind, close: CLOSE * 0.4 };
        break;
      }
    }
  }
  return best;
}

/** Whether `a` and `b` (or `b`'s first `length` letters) are at most one insertion, deletion, substitution or swap of neighbors apart. */
export function withinOneEdit(a: string, b: string, length = b.length): boolean {
  const la = a.length;
  const lb = Math.min(length, b.length);
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (i === la && i === lb) return true;
  if (la === lb) {
    if (sameFrom(a, i + 1, b, i + 1, lb)) return true;
    return i + 1 < lb && a.charCodeAt(i) === b.charCodeAt(i + 1) && a.charCodeAt(i + 1) === b.charCodeAt(i) && sameFrom(a, i + 2, b, i + 2, lb);
  }
  return la > lb ? sameFrom(a, i + 1, b, i, lb) : sameFrom(a, i, b, i + 1, lb);
}

/** Whether `a` from `ai` is `b` from `bi` up to `end`. */
function sameFrom(a: string, ai: number, b: string, bi: number, end: number): boolean {
  if (a.length - ai !== end - bi) return false;
  for (let k = 0; ai + k < a.length; k++) if (a.charCodeAt(ai + k) !== b.charCodeAt(bi + k)) return false;
  return true;
}

// The scorer's rows, kept between calls so a keystroke allocates nothing.
let previousRow = new Float64Array(FUZZY_MAX);
let currentRow = new Float64Array(FUZZY_MAX);
const NONE = Number.NEGATIVE_INFINITY;
/** What a letter earns: at a word start, right after the last one, or after a gap inside the same word. */
const AT_START = 3;
const NEXT = 2;
const AFTER_GAP = 1;
const GAP = 0.5;

/**
 * The query's letters in `target` in order, as a closeness 0–39, or null. The
 * first letter is at a word start; each next one follows the last, starts a
 * later word, or (from four letters, or inside a single word from three)
 * comes after a gap in the same word. Dynamic programming over (letter,
 * position), linear in the target per letter.
 */
export function fuzzyScore(query: string, target: Folded): number | null {
  const m = query.length;
  const { text, starts, word } = target;
  const n = Math.min(text.length, FUZZY_MAX);
  if (m < FUZZY_FROM || m > n || !inOrder(query, target, n)) return null;
  const gaps = m >= GAPS_FROM;
  for (let j = 0; j < n; j++) previousRow[j] = starts[j] === 1 && text.charCodeAt(j) === query.charCodeAt(0) ? AT_START : NONE;
  for (let i = 1; i < m; i++) {
    const letter = query.charCodeAt(i);
    let before = NONE;
    let run = NONE;
    let any = false;
    for (let j = 0; j < n; j++) {
      if (starts[j] === 1) run = NONE;
      let score = NONE;
      if (text.charCodeAt(j) === letter) {
        const last = j > 0 ? (previousRow[j - 1] as number) : NONE;
        if (last > NONE) score = last + NEXT;
        if (starts[j] === 1 && before > NONE) score = Math.max(score, before + AT_START);
        if (gaps && run > NONE) score = Math.max(score, run + AFTER_GAP);
      }
      currentRow[j] = score;
      if (score > NONE) any = true;
      before = Math.max(before, previousRow[j] as number);
      const last = j > 0 && word[j - 1] === word[j] ? (previousRow[j - 1] as number) : NONE;
      run = Math.max(run, last) - GAP;
    }
    if (!any) return m === FUZZY_FROM ? oneWord(query, target) : null;
    [previousRow, currentRow] = [currentRow, previousRow];
  }
  let best = NONE;
  for (let j = 0; j < n; j++) best = Math.max(best, previousRow[j] as number);
  if (best === NONE) return null;
  const most = AT_START + NEXT * (m - 1);
  return Math.max(0, Math.min(CLOSE, (CLOSE * best) / most));
}

/**
 * Whether the query's letters come in order after a word start with its
 * first letter: what every fuzzy match needs, checked in one pass before the
 * scorer's rows are filled. The earliest such start is the best place to try.
 */
function inOrder(query: string, target: Folded, n: number): boolean {
  const { text, starts } = target;
  const first = query.charCodeAt(0);
  let j = 0;
  while (j < n && !(starts[j] === 1 && text.charCodeAt(j) === first)) j++;
  if (j === n) return false;
  let k = 1;
  for (j++; j < n && k < query.length; j++) if (text.charCodeAt(j) === query.charCodeAt(k)) k++;
  return k === query.length;
}

/** Vowels: an abbreviation drops them ("msg"), a word keeps them ("tea"). */
const VOWEL = /[aeiouy]/;

/**
 * Three letters in order inside one word, from its start ("msg" in Messages): a weak fuzzy match,
 * for abbreviations only. Three letters with a vowel after the first read as a word ("tea"), and a
 * word is looked for as itself, not spread through another one (Terminal).
 */
function oneWord(query: string, target: Folded): number | null {
  if (VOWEL.test(query.slice(1))) return null;
  for (const each of target.words) {
    if (each[0] !== query[0]) continue;
    let k = 1;
    for (let i = 1; i < each.length && k < query.length; i++) if (each[i] === query[k]) k++;
    if (k === query.length) return CLOSE * 0.25;
  }
  return null;
}
