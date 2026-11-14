/**
 * Tidying by rule (docs/voice.md, "Dictation"): what was heard becomes what
 * is typed, on this computer, with no model. Fillers go out, punctuation
 * said out loud becomes the mark, a simple change of mind is carried out,
 * and spaces and capitals are set. Its own check (tidy-check.ts) reads the
 * result: when it does not hold, the words land as heard.
 */

import type { TidyChange } from "../../shared/pill/index.ts";
import { keepsMeaning } from "./tidy-check.ts";
import { changeMind } from "./tidy-mind.ts";
import { ends, render, settle, type Token, tokens } from "./tidy-tokens.ts";
import { FILLERS, SET_OFF_FILLERS, SPOKEN, type Spoken } from "./tidy-words.ts";

export interface Tidied {
  typed: string;
  heard: string;
  changes: TidyChange[];
  /** The check did not hold, so `typed` is as heard. */
  asHeard: boolean;
}

const lower = (token: Token | undefined): string => token?.text.toLowerCase() ?? "";
const isComma = (token: Token | undefined): boolean => token !== undefined && !token.word && token.text === ",";
const wordsAt = (list: readonly Token[], at: number, words: readonly string[]): boolean =>
  words.every((word, nth) => list[at + nth]?.word === true && lower(list[at + nth]) === word);

function spokenAt(list: readonly Token[], at: number): Spoken | null {
  for (const spoken of SPOKEN) {
    if (!wordsAt(list, at, spoken.words)) continue;
    const before = list[at - 1];
    if (before?.word && spoken.notAfter?.includes(lower(before))) continue;
    if (spoken.closes) {
      // "period" ends a sentence only where one ends: before a mark, another spoken mark, or nothing.
      let next = at + spoken.words.length;
      while (isComma(list[next])) next++;
      const after = list[next];
      const closing = after === undefined || ends(after) || (after.word && spokenAt(list, next) !== null);
      if (!closing || before === undefined) continue;
    }
    return spoken;
  }
  return null;
}

/** Punctuation said out loud becomes the mark; how many. */
function punctuate(list: readonly Token[]): { tokens: Token[]; count: number } {
  const out: Token[] = [];
  let count = 0;
  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (!token) continue;
    const spoken = token.word ? spokenAt(list, at) : null;
    if (!spoken) {
      out.push(token);
      continue;
    }
    out.push({ text: spoken.mark, word: false, gap: false, made: true });
    at += spoken.words.length - 1;
    count++;
  }
  return { tokens: out, count };
}

/** How many tokens a filler takes at `at`, or 0. */
function fillerAt(list: readonly Token[], at: number): number {
  const token = list[at];
  if (!token?.word) return 0;
  if (FILLERS.has(lower(token))) return 1;
  for (const words of SET_OFF_FILLERS) {
    if (wordsAt(list, at, words) && isComma(list[at - 1]) && isComma(list[at + words.length])) return words.length;
  }
  return 0;
}

/** Fillers go, each with the comma or the full stop that was only theirs; how many. */
function unfill(list: readonly Token[]): { tokens: Token[]; count: number } {
  const out: Token[] = [];
  let count = 0;
  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (!token) continue;
    const length = fillerAt(list, at);
    if (length === 0) {
      out.push(token);
      continue;
    }
    count++;
    at += length - 1;
    const before = out.at(-1);
    const alone = before === undefined || ends(before);
    // "Um, I think": its comma goes with it. "Uh. I think": so does its full stop.
    while (isComma(list[at + 1]) || (alone && ends(list[at + 1]) && !list[at + 1]?.made)) at++;
    const after = list[at + 1];
    if (isComma(before) && (after === undefined || ends(after))) out.pop();
  }
  return { tokens: out, count };
}

const counted = (kind: "filler" | "spacing" | "capital" | "punctuation", count: number): TidyChange[] => (count > 0 ? [{ kind, count }] : []);

/** What is typed for what was heard. `on: false` types it as heard. */
export function tidy(heard: string, on = true): Tidied {
  const said = heard.trim();
  const asHeard = (failed: boolean): Tidied => ({ typed: said, heard: said, changes: [], asHeard: failed });
  if (!on || said === "") return asHeard(false);
  const mind = changeMind(tokens(said));
  const marks = punctuate(mind.tokens);
  const fills = unfill(marks.tokens);
  const out = render(settle(fills.tokens));
  // A line break said first or last is kept: "new line" alone is a line break.
  const typed = out.text.replace(/^[ \t]+|[ \t]+$/g, "");
  if (typed === "" || !keepsMeaning(said, typed, mind.changes)) return asHeard(true);
  const changes: TidyChange[] = [
    ...mind.changes.map((change): TidyChange => ({ kind: "change-of-mind", from: change.from, to: change.to })),
    ...counted("filler", fills.count),
    ...counted("punctuation", marks.count),
    ...counted("spacing", out.spacing),
    ...counted("capital", out.capitals),
  ];
  return { typed, heard: said, changes, asHeard: false };
}
