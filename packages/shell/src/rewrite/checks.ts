/**
 * The checks on what the model answered (docs/dictation-rewrite.md, "The
 * checks"). A rewrite may take words out and mend a few; it may not answer,
 * obey, translate, grow, or lose a number or a name the person did not take
 * back. A failed check means the rules' text lands.
 */

import { finalWords, isAside, isCue, isNot, isNumber, near, openingCue, same, wordsOf } from "./lib/words.ts";
import { CLOSE, OPEN } from "./prompt.ts";

export type CheckName =
  | "empty"
  | "tags"
  | "longer"
  | "lines"
  | "overlap"
  | "repeated"
  | "after-cue"
  | "opening"
  | "earlier"
  | "dropped"
  | "quotes"
  | "numbers"
  | "negation"
  | "vocabulary";

export type Checked = { ok: true; text: string; unchanged: boolean } | { ok: false; check: CheckName };

/** The share of the answer's words that must have been said (or be one slip from a word that was). */
export const OVERLAP_FLOOR = 0.7;
/** An answer may have this many words more than the transcript, for a split word or a mended one. */
export const LONGER_BY = 2;

const TAGS = /<\/?transcript>|<\|[^|>]*\|>|<\/?think>/i;
/** A chat role at the head of the answer, which the transcript did not start with itself. */
const ROLE = /^\s*(?:assistant|user|system)\s*:/i;

const CONTEXT_LINES = /^(?:(?:Vocabulary|Tone|Already typed)[^\n]*\n)+/;

/**
 * The answer with the frame taken off, when the model gave the message back around its answer:
 * the lines before the transcript ("Vocabulary: …") and the tags themselves, if they are whole.
 */
function unframed(answer: string): string {
  let text = answer.trim().replace(CONTEXT_LINES, "").trim();
  if (text.startsWith(OPEN)) {
    text = text.slice(OPEN.length).trim();
    if (text.endsWith(CLOSE)) text = text.slice(0, -CLOSE.length).trim();
  }
  return text;
}

const lineBreaks = (text: string): number => text.split("\n").length - 1;

/** Whether a word of the transcript at `at`, gone from the answer, may be gone: a cue comes after it, or it was said twice. */
function takenBack(said: readonly string[], at: number): boolean {
  const word = said[at];
  if (said[at + 1] === word || said[at - 1] === word) return true;
  return said.slice(at + 1).some(isCue);
}

/** Every number said is still there, unless it was taken back (said twice counts once). */
function keepsNumbers(said: readonly string[], kept: readonly string[]): boolean {
  return said.every((word, at) => !isNumber(word) || kept.some((other) => same(word, other)) || takenBack(said, at));
}

/** A "don't" or a "shouldn't" (even one that lost its ending) is still a "not" in the answer, unless it was taken back. */
function keepsNots(said: readonly string[], kept: readonly string[]): boolean {
  const nots = said.filter((word, at) => isNot(word) && !takenBack(said, at)).length;
  return nots <= kept.filter((word) => isNot(word) || word === "not" || word === "cannot").length;
}

/** What was said after the last cue is the final version: an answer without it kept the earlier one. */
function keepsLater(said: readonly string[], kept: readonly string[]): boolean {
  return finalWords(said).every((word) => kept.some((other) => same(word, other)));
}

/**
 * A cue the answer still holds was not carried out there, so what follows it must be what followed it when said
 * ("Quiero un café con leche, mejor dicho, un té" answered "Quiero un té con leche, mejor dicho" moved the later
 * words before the cue and kept it: refused, found in the VM).
 */
function keepsAfterCue(said: readonly string[], kept: readonly string[]): boolean {
  const at = kept.findLastIndex(isCue);
  if (at < 0) return true;
  // In the untouched start of the sentence it was no cue ("Quiero tres cafés": "quiero" as in "quiero decir").
  const start = said.filter((word) => !isAside(word));
  const head = kept.slice(0, at + 1).filter((word) => !isAside(word));
  if (head.every((word, index) => same(word, start[index] ?? ""))) return true;
  const from = said.lastIndexOf(kept[at] ?? "");
  if (from < 0) return true;
  const after = kept.slice(at + 1);
  const before = said.slice(from + 1);
  return after.length === before.length && after.every((word, index) => same(word, before[index] ?? ""));
}

/** A cue the transcript opens with takes nothing back: it must still open the answer. */
function keepsOpening(said: readonly string[], kept: readonly string[]): boolean {
  const cue = openingCue(said);
  return cue === null || kept.slice(0, said.indexOf(cue) + 1).includes(cue);
}

/**
 * With no cue anywhere, words may go only as a phrase started again ("can you send, could you
 * forward"): a quarter or more of what went is said again in what stayed. Fillers, a word said twice
 * in a row, and a word that was mended (another stands in its place) do not count as gone.
 */
function dropsOnlyRestarts(said: readonly string[], kept: readonly string[]): boolean {
  if (said.some(isCue)) return true;
  const left = [...kept];
  const gone: string[] = [];
  // Words that went but are still in the answer: said twice, the mark of a phrase started again.
  let again = 0;
  said.forEach((word, at) => {
    const found = left.findIndex((other) => near(word, other));
    if (found >= 0) {
      left.splice(found, 1);
      return;
    }
    if (kept.includes(word)) again++;
    if (!isAside(word) && said[at + 1] !== word && said[at - 1] !== word) gone.push(word);
  });
  // What is left of the answer are new words: each stands in for one that went.
  const dropped = gone.length - left.length;
  return dropped <= 0 || again * 4 >= gone.length;
}

/** What the speaker put in quotation marks is kept to the word. */
function keepsQuotes(transcript: string, text: string): boolean {
  const plain = wordsOf(text).join(" ");
  const quoted = transcript.match(/"[^"]+"|“[^”]+”|«[^»]+»/g) ?? [];
  return quoted.every((quote) => plain.includes(wordsOf(quote).join(" ")));
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
  const known = [...new Set([...said, ...vocabulary.flatMap(wordsOf)])];
  const hits = kept.filter((word) => known.some((other) => same(word, other))).length;
  return hits / kept.length;
}

/** No word of substance is said more often than the speaker said it: "the green one, actually the green one" for "the blue one, actually the green one". */
function repeatsNothing(said: readonly string[], kept: readonly string[]): boolean {
  const times = (words: readonly string[], word: string): number => words.filter((each) => each === word).length;
  return [...new Set(kept)].every((word) => word.length < 4 || isCue(word) || isAside(word) || times(kept, word) <= Math.max(1, times(said, word)));
}

/** The answer, if it may land in place of `transcript`; else the check it failed. */
export function checkAnswer(transcript: string, answer: string, vocabulary: readonly string[] = []): Checked {
  const text = unframed(answer);
  if (text === "") return { ok: false, check: "empty" };
  if (TAGS.test(text) || (ROLE.test(text) && !ROLE.test(transcript))) return { ok: false, check: "tags" };
  const said = wordsOf(transcript);
  const kept = wordsOf(text);
  if (kept.length === 0) return { ok: false, check: "empty" };
  if (kept.length > said.length + LONGER_BY) return { ok: false, check: "longer" };
  if (lineBreaks(text) !== lineBreaks(transcript.trim())) return { ok: false, check: "lines" };
  if (overlap(said, kept, vocabulary) < OVERLAP_FLOOR) return { ok: false, check: "overlap" };
  if (!repeatsNothing(said, kept)) return { ok: false, check: "repeated" };
  if (!keepsOpening(said, kept)) return { ok: false, check: "opening" };
  if (!keepsLater(said, kept)) return { ok: false, check: "earlier" };
  if (!keepsAfterCue(said, kept)) return { ok: false, check: "after-cue" };
  if (!keepsQuotes(transcript, text)) return { ok: false, check: "quotes" };
  if (!keepsNumbers(said, kept)) return { ok: false, check: "numbers" };
  if (!keepsNots(said, kept)) return { ok: false, check: "negation" };
  if (!keepsVocabulary(said, kept, vocabulary)) return { ok: false, check: "vocabulary" };
  if (!dropsOnlyRestarts(said, kept)) return { ok: false, check: "dropped" };
  const same = text.replace(/\s+/g, " ") === transcript.trim().replace(/\s+/g, " ");
  return { ok: true, text, unchanged: same };
}
