/**
 * Find and Replace over the document's text: where a query matches (plain
 * text, not a pattern; case-insensitive unless asked), which match is next
 * from the one shown, which line a match is on, and Replace All. Matches do
 * not overlap, and a very common query stops counting at `MATCH_LIMIT`.
 */

export const MATCH_LIMIT = 10_000;

export interface FindOptions {
  caseSensitive: boolean;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(query: string, options: FindOptions): RegExp {
  return new RegExp(escapeRegExp(query), options.caseSensitive ? "g" : "gi");
}

/** Where `query` starts in `text`, in order; empty for an empty query. */
export function findMatches(text: string, query: string, options: FindOptions = { caseSensitive: false }): number[] {
  if (query === "") return [];
  const out: number[] = [];
  for (const match of text.matchAll(pattern(query, options))) {
    out.push(match.index);
    if (out.length >= MATCH_LIMIT) break;
  }
  return out;
}

/**
 * The match to show after `current` going `step` (+1 next, -1 previous),
 * wrapping; with none shown yet, the first or the last. -1 when there are none.
 */
export function stepMatch(count: number, current: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** The first match at or after `offset` (the next one after an edit), or -1. */
export function matchAtOrAfter(matches: readonly number[], offset: number): number {
  const index = matches.findIndex((start) => start >= offset);
  return index >= 0 ? index : matches.length > 0 ? 0 : -1;
}

/** The 1-based line `offset` is on. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return line;
}

/** Where 1-based line `line` starts in `text`, clamped to its first and last lines. */
export function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) break;
    offset = next + 1;
  }
  return offset;
}

/** How many lines `text` has: one more than its line breaks. */
export function lineCount(text: string): number {
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lines++;
  return lines;
}

/** `text` with every match of `query` replaced (taken literally, `$` and all), and how many there were. */
export function replaceAll(text: string, query: string, replacement: string, options: FindOptions = { caseSensitive: false }): { text: string; count: number } {
  if (query === "") return { text, count: 0 };
  let count = 0;
  const next = text.replace(pattern(query, options), () => {
    count++;
    return replacement;
  });
  return { text: next, count };
}
