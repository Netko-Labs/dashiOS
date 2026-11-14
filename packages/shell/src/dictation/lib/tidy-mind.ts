/**
 * A change of mind (tidy.ts): "no wait", "scratch that", "no, perdón". The
 * phrase counts only when it stands apart, a mark or the start before it and
 * a mark or the end after it ("there's no wait at the door" is not one);
 * starting a sentence it may run straight into a word or two ("No wait
 * Wednesday.").
 * What it takes back, the simple way:
 *
 * - nothing follows it: the sentence before it goes;
 * - what follows starts with a word the sentence already had: the sentence
 *   is cut back to that word ("on Tuesday, no wait, on Wednesday");
 * - one or two words follow: they replace the sentence's last one or two;
 * - more follows: the sentence starts again with it.
 */

import type { TakenBack } from "./tidy-check.ts";
import { ends, type Token } from "./tidy-tokens.ts";
import { CHANGES_OF_MIND } from "./tidy-words.ts";

export interface MindChange extends TakenBack {
  from: string;
  to: string;
}

const lower = (token: Token): string => token.text.toLowerCase();
const text = (list: readonly Token[]): string =>
  list
    .filter((token) => token.word)
    .map((token) => token.text)
    .join(" ");

function wordsToEnd(list: readonly Token[], from: number): number {
  let count = 0;
  for (let at = from; at < list.length && !ends(list[at]); at++) if (list[at]?.word) count++;
  return count;
}

/** How many tokens the phrase takes at `at` (its words, with a comma allowed between them), or 0. */
function phraseAt(list: readonly Token[], at: number): number {
  for (const phrase of CHANGES_OF_MIND) {
    let index = at;
    let matched = true;
    for (const [nth, word] of phrase.entries()) {
      if (nth > 0 && list[index]?.text === ",") index++;
      const token = list[index];
      if (!token?.word || lower(token) !== word) {
        matched = false;
        break;
      }
      index++;
    }
    if (!matched) continue;
    const before = list[at - 1];
    const after = list[index];
    if (before === undefined || (before.word && !ends(before))) continue;
    // No mark after it ("No wait Wednesday."): only a sentence's start, and only a word or two to its end.
    if (after?.word && !(ends(before) && wordsToEnd(list, index) <= 2)) continue;
    return index - at;
  }
  return 0;
}

interface Found {
  /** Where the sentence taken back starts and where its words end. */
  start: number;
  end: number;
  /** The phrase, and where what replaces it starts and ends. */
  phrase: number;
  length: number;
  from: number;
  to: number;
}

function find(list: readonly Token[]): Found | null {
  for (let at = 1; at < list.length; at++) {
    const length = phraseAt(list, at);
    if (length === 0) continue;
    let end = at;
    while (end > 0 && !list[end - 1]?.word) end--;
    let start = end;
    while (start > 0 && !ends(list[start - 1])) start--;
    if (end === start) continue;
    let from = at + length;
    while (from < list.length && !list[from]?.word) from++;
    let to = from;
    while (to < list.length && !ends(list[to])) to++;
    return { start, end, phrase: at, length, from, to };
  }
  return null;
}

/** Where the cut starts: the word the replacement begins with, the last one or two words, or the whole sentence. */
function cutFrom(list: readonly Token[], found: Found, replacement: readonly Token[]): number {
  const first = replacement[0];
  if (!first) return found.start;
  for (let at = found.end - 1; at >= found.start; at--) {
    const token = list[at];
    if (token?.word && lower(token) === lower(first)) return at;
  }
  if (replacement.length > 2) return found.start;
  let left = replacement.length;
  let at = found.end;
  while (at > found.start && left > 0) {
    at--;
    if (list[at]?.word) left--;
  }
  return at;
}

/** The tokens with each change of mind carried out, and what each took back. */
export function changeMind(input: readonly Token[]): { tokens: Token[]; changes: MindChange[] } {
  let list = [...input];
  const changes: MindChange[] = [];
  for (let round = 0; round < 8; round++) {
    const found = find(list);
    if (!found) break;
    const replacement = list.slice(found.from, found.to).filter((token) => token.word);
    const cut = cutFrom(list, found, replacement);
    const struck = list.slice(cut, found.from);
    const phrase = list.slice(found.phrase, found.phrase + found.length).filter((token) => token.word);
    const rest = list.slice(found.from);
    const head = rest[0];
    const replaced = list[cut];
    // A replacement the model began a sentence with is no sentence's start where it lands.
    if (head?.word && replaced?.word && cut > found.start && /^\p{Ll}/u.test(replaced.text) && /^\p{Lu}\p{Ll}*$/u.test(head.text)) {
      rest[0] = { ...head, text: head.text.toLowerCase() };
    }
    if (rest[0]) rest[0] = { ...rest[0], gap: cut > 0 };
    changes.push({
      from: text(list.slice(cut, found.end)),
      to: text(replacement.slice(0, 5)),
      struck: struck.filter((token) => token.word).map(lower),
      kept: replacement.map(lower),
      phrase: phrase.map(lower),
      sentence: list
        .slice(found.start, found.end)
        .filter((token) => token.word)
        .map(lower),
    });
    list = [...list.slice(0, cut), ...rest];
  }
  return { tokens: list, changes };
}
