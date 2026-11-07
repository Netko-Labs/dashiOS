/**
 * Find in the open note: where the search's words are in its body (case and
 * accents ignored, as the list's search ignores them), drawn on a wash, and
 * Edit › Find Next and Find Previous step the selection through them. Pure.
 */

import type { Selection } from "./format.ts";
import { fold } from "./text.ts";

/** Each place in `body` that holds one of the query's words, in order, never overlapping. */
export function findMatches(body: string, query: string): Selection[] {
  const words = [...new Set(fold(query).split(/\s+/).filter(Boolean))];
  if (words.length === 0 || body === "") return [];
  // The folded body, and for each of its code units the body offset it came from.
  let folded = "";
  const from: number[] = [];
  for (let at = 0; at < body.length; ) {
    const point = body.codePointAt(at) ?? 0;
    const char = String.fromCodePoint(point);
    const piece = fold(char);
    for (let unit = 0; unit < piece.length; unit++) from.push(at);
    folded += piece;
    at += char.length;
  }
  from.push(body.length);
  const found: Selection[] = [];
  for (const word of words) {
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) {
      found.push({ start: from[at] ?? 0, end: from[at + word.length] ?? body.length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  return found.filter((match, index) => index === 0 || match.start >= (found[index - 1]?.end ?? 0));
}

/** The match after the selection (`step` 1) or before it (-1), wrapping around; null when there is none. */
export function nextMatch(matches: readonly Selection[], selection: Selection, step: 1 | -1): Selection | null {
  if (matches.length === 0) return null;
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (step === 1) return matches.find((match) => match.start >= end && !(match.start === start && match.end === end)) ?? matches[0] ?? null;
  return [...matches].reverse().find((match) => match.end <= start) ?? matches.at(-1) ?? null;
}
