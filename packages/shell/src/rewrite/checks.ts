/**
 * The checks on what the model answered (docs/dictation-rewrite.md, "The
 * checks"). A rewrite may take words out and mend a few; it may not answer,
 * obey, translate, grow, or lose a number or a name the person did not take
 * back. A failed check means the rules' text lands.
 */

import { isCue, isNumber, near, wordsOf } from "./lib/words.ts";
import { CLOSE, OPEN } from "./prompt.ts";

export type CheckName = "empty" | "tags" | "longer" | "lines" | "overlap" | "numbers" | "vocabulary";

export type Checked = { ok: true; text: string; unchanged: boolean } | { ok: false; check: CheckName };

/** The share of the answer's words that must have been said (or be one slip from a word that was). */
export const OVERLAP_FLOOR = 0.7;
/** An answer may have this many words more than the transcript, for a split word or a mended one. */
export const LONGER_BY = 2;

const TAGS = /<\/?transcript>|<\|[^|>]*\|>|<\/?think>|^\s*(?:assistant|user|system)\s*:/im;

/** The answer with the frame taken off, if the model gave it back whole. */
function unframed(answer: string): string {
  const text = answer.trim();
  if (text.startsWith(OPEN) && text.endsWith(CLOSE)) return text.slice(OPEN.length, -CLOSE.length).trim();
  return text;
}

const lineBreaks = (text: string): number => text.split("\n").length - 1;

/** Whether a word of the transcript at `at`, gone from the answer, may be gone: a cue comes after it, or it was said twice. */
function takenBack(said: readonly string[], at: number): boolean {
  const word = said[at];
  if (said[at + 1] === word || said[at - 1] === word) return true;
  return said.slice(at + 1).some(isCue);
}

function keepsNumbers(said: readonly string[], kept: readonly string[]): boolean {
  const left = [...kept];
  for (let at = said.length - 1; at >= 0; at--) {
    const word = said[at];
    if (word === undefined || !isNumber(word)) continue;
    const found = left.lastIndexOf(word);
    if (found >= 0) left.splice(found, 1);
    else if (!takenBack(said, at)) return false;
  }
  return true;
}

/** Where a term's words stand in a row in `words`, or -1. */
function termAt(words: readonly string[], term: readonly string[]): number {
  for (let at = 0; at + term.length <= words.length; at++) if (term.every((word, nth) => words[at + nth] === word)) return at;
  return -1;
}

function keepsVocabulary(said: readonly string[], kept: readonly string[], vocabulary: readonly string[]): boolean {
  for (const entry of vocabulary) {
    const term = wordsOf(entry);
    if (term.length === 0) continue;
    const at = termAt(said, term);
    if (at >= 0 && termAt(kept, term) < 0 && !takenBack(said, at + term.length - 1)) return false;
  }
  return true;
}

function overlap(said: readonly string[], kept: readonly string[], vocabulary: readonly string[]): number {
  if (kept.length === 0) return 0;
  const known = new Set([...said, ...vocabulary.flatMap(wordsOf)]);
  const list = [...known];
  const hits = kept.filter((word) => known.has(word) || list.some((other) => near(word, other))).length;
  return hits / kept.length;
}

/** The answer, if it may land in place of `transcript`; else the check it failed. */
export function checkAnswer(transcript: string, answer: string, vocabulary: readonly string[] = []): Checked {
  const text = unframed(answer);
  if (text === "") return { ok: false, check: "empty" };
  if (TAGS.test(text)) return { ok: false, check: "tags" };
  const said = wordsOf(transcript);
  const kept = wordsOf(text);
  if (kept.length === 0) return { ok: false, check: "empty" };
  if (kept.length > said.length + LONGER_BY) return { ok: false, check: "longer" };
  if (lineBreaks(text) !== lineBreaks(transcript.trim())) return { ok: false, check: "lines" };
  if (overlap(said, kept, vocabulary) < OVERLAP_FLOOR) return { ok: false, check: "overlap" };
  if (!keepsNumbers(said, kept)) return { ok: false, check: "numbers" };
  if (!keepsVocabulary(said, kept, vocabulary)) return { ok: false, check: "vocabulary" };
  const same = text.replace(/\s+/g, " ") === transcript.trim().replace(/\s+/g, " ");
  return { ok: true, text, unchanged: same };
}
