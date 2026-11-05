/**
 * "Did you mean Firefox?" when nothing matched: one typo forgiven (a letter
 * missing, extra, wrong, or two swapped) from four letters on, against an
 * app's or a pane's whole name or one of its words. This only suggests; it
 * never ranks. Matching that forgives typos as you type is the ranking
 * engine's (wave 2), not this.
 */

import type { Entry } from "../entries.ts";

/** Shorter queries are too easy to be one letter from anything. */
export const MIN_SUGGEST = 4;

/** Edit distance with swaps of neighbours (optimal string alignment), stopping early past `limit`. */
export function typoDistance(a: string, b: string, limit = 1): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number): number => rows[i]?.[j] ?? Number.POSITIVE_INFINITY;
  for (let i = 1; i <= a.length; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, at(i - 2, j - 2) + 1);
      (rows[i] as number[])[j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
  }
  return at(a.length, b.length);
}

/** The listed entry `query` is one typo away from, or null. Ties go to the shell's own, then A to Z. */
export function didYouMean(entries: readonly Entry[], query: string): Entry | null {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_SUGGEST) return null;
  const close = entries.filter((entry) => {
    if (entry.hidden) return false;
    const name = entry.name.toLowerCase();
    return [name, ...name.split(/[\s\-_.&]+/).filter((word) => word.length >= MIN_SUGGEST)].some((candidate) => typoDistance(q, candidate) <= 1);
  });
  close.sort((a, b) => Number(b.shell === true) - Number(a.shell === true) || a.name.localeCompare(b.name));
  return close[0] ?? null;
}
