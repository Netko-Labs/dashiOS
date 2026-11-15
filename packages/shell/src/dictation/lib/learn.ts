/**
 * Learning from a fix (landings.ts; research 1.11, "learn from the fix,
 * visibly"): after words land, the field is read again a few times. If the
 * person changed one word or a short run of them, with the words round it
 * still as Dashi typed them, the capsule offers to always write it their
 * way. Never learned silently, never from a field that can't be read, and
 * never a number, a path or an address.
 */

import type { Pair } from "../types.ts";

/** When the field is read again after a landing, in ms. */
export const LOOK_AGAIN_MS: readonly number[] = [2500, 5000, 8000];

/** A fix is this many words at most, on either side. */
const MOST = 3;

const wordsOf = (text: string): string[] => text.match(/[^\s]+/g) ?? [];
/** A word without the marks that hug it, as it is compared and learned. */
const bare = (word: string): string => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((word, index) => bare(word) === bare(b[index] ?? ""));

/** Not worth learning: a number, a path, an address, code. */
const unlearnable = (text: string): boolean => /[\d/@_\\<>{}=]/.test(text) || text.length > 40 || text.length < 2;

/** The one fix that turns `typed` into what `field` now holds where it was, as heard → written; null when there is none, or more than one. */
export function correctionOf(typed: string, field: string): Pair | null {
  const was = wordsOf(typed);
  const now = wordsOf(field);
  if (was.length < 2) return null;
  for (let start = 0; start < now.length; start++) {
    let head = 0;
    while (head < was.length && bare(was[head] ?? "") === bare(now[start + head] ?? "")) head++;
    if (head === was.length) return null;
    for (let gone = 1; gone <= MOST && head + gone <= was.length; gone++) {
      for (let came = 1; came <= MOST; came++) {
        const tail = was.slice(head + gone);
        // The words round the fix must still be Dashi's: two of them at least, and at the start only what was typed.
        if (head + tail.length < 2 || (head === 0 && start > 0 && tail.length < 2)) continue;
        if (!same(tail, now.slice(start + head + came, start + head + came + tail.length))) continue;
        const from = was
          .slice(head, head + gone)
          .map(bare)
          .join(" ");
        const to = now
          .slice(start + head, start + head + came)
          .map(bare)
          .join(" ");
        if (from === to || from === "" || to === "" || unlearnable(from) || unlearnable(to)) continue;
        return { from, to };
      }
    }
  }
  return null;
}

/** "Always write “Claude Code” for “cloud code”?" */
export const offerLine = (pair: Pair): string =>
  pair.from.toLowerCase() === pair.to.toLowerCase() ? `Always write “${pair.to}”?` : `Always write “${pair.to}” for “${pair.from}”?`;
