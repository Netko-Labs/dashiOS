/**
 * The gate (land.ts; research 3.1, stage 2): does this utterance need the
 * correction model? A short clean sentence does not: the model can only
 * make it worse, and it costs the wait. It is asked when the rules' text
 * still holds something only a model can settle:
 *
 * - `cue`: the speaker corrected themselves after saying something ("at
 *   five, no, six", "I mean", "actually", "perdón", "digo", "mejor dicho"),
 *   or said something twice;
 * - `list`: list markers the rules did not make a list of;
 * - `run-on`: a long run of words with no mark in it;
 * - `non-word`: a word no dictionary knows (English only: the stem list
 *   does not know Spanish verb forms);
 * - `near-term`: a word that begins what a vocabulary term is heard as
 *   ("cloud", of "cloud code"), which may be the term said alone;
 * - `polish`: the profile asks for every utterance.
 *
 * Never at a shell's prompt, in Verbatim, or with tidying off.
 */

import type { Term } from "../types.ts";
import type { Words } from "../words.ts";
import { languageScores } from "./language.ts";

export type GateReason = "cue" | "list" | "run-on" | "non-word" | "near-term" | "polish";

/**
 * Said after something else, these take it back. The list covers what the model was scored on in English, Spanish and
 * a mix (docs/dictation-rewrite.md, "The evaluation set"): "no, I mean", "actually", "wait", "sorry", "never mind",
 * "no, digo", "perdón", "mejor dicho", "o sea, no", "quise decir", "miento", and a bare "no" set off by a pause.
 */
const CUES: readonly RegExp[] = [
  /\bI mean(?:t)?\b/gi,
  /\b(?:sorry|perdón|perdon)\b/gi,
  // "I actually like it" is not one: a pause beside it, or the thing said again after it ("an hour actually for two").
  /,\s*actually\b|\bactually(?:,|\s+(?:for|to|at|on|in|by|the|a|an|\d))/gi,
  /[,.;]\s+(?:(?:or|o)\s+)?(?:wait|espera|rather|miento|correction|corrijo|never ?mind|olv[ií]dalo|borra eso|en realidad)\b/gi,
  /\b(?:or rather|scratch that|mejor dicho|quise decir|quiero decir|o sea,? no)\b/gi,
  /\bno,? no\b|\bbut no\b|\bnot(?: \w+)?,? but\b/gi,
  // A "no" after a pause that goes on to say the thing again: ", no, six", ". No, it's Wednesday", ", no the blue one".
  /[,.;]\s+(?:(?:ay|bueno|oh|or|o|espera|wait)\s+)?no(?:,|\s+(?:the|a|an|el|la|los|las|un|una|wait|digo|espera|mejor|\d))/gi,
  // "digo" as "I mean", never "te digo que".
  /(?<!\b(?:te|le|les|os|se|lo|que|yo|como|les)\s)\bdigo\b/gi,
];

/** Words a transcript may open with that are not yet something to take back ("No, I mean it.", "Hey, but no"). */
const OPENERS = new Set("no hey oh well but so and or yes ok okay bueno pues ay um uh y o si sí".split(" "));

/** Whether a cue comes after something said: one that opens the utterance takes nothing back and is what the speaker means. */
function cued(text: string): boolean {
  return CUES.some((cue) => [...text.matchAll(cue)].some((match) => wordsIn(text.slice(0, match.index)).some((word) => !OPENERS.has(word.toLowerCase()))));
}

const LIST_MARKERS = /\b(?:first(?:ly)?|second(?:ly)?|third|bullet point|next item|here(?:'s| is) the list|primero|segundo|tercero|viñeta)\b/gi;

/** A run of this many words with no mark in it was said without a pause. */
const RUN_ON_WORDS = 20;

const wordsIn = (text: string): string[] => text.match(/[\p{L}\p{N}'’]+/gu) ?? [];

/** The same word, or the same two words, said twice in a row or close by: a false start. */
function repeats(text: string): boolean {
  const words = wordsIn(text).map((word) => word.toLowerCase());
  for (let at = 1; at < words.length; at++) {
    const word = words[at] ?? "";
    if (word === words[at - 1] && word.length > 1 && !/^\d+$/.test(word) && word !== "very" && word !== "really") return true;
    // "right now … right now": a pair said again within a few words.
    const pair = `${words[at - 1]} ${word}`;
    for (let back = at - 2; back >= 1 && back >= at - 8; back--) if (`${words[back - 1]} ${words[back]}` === pair && pair.length > 6) return true;
  }
  return false;
}

function runOn(text: string): boolean {
  return text.split(/[.,;:!?…\n]/).some((part) => wordsIn(part).length >= RUN_ON_WORDS);
}

function nonWord(text: string, terms: readonly Term[], words: Words): boolean {
  if (!words.loaded) return false;
  const scores = languageScores(text);
  if (scores.es > scores.en) return false;
  const known = new Set(terms.flatMap((each) => each.term.toLowerCase().split(/\s+/)));
  return wordsIn(text).some((word) => {
    // A name, an acronym, a number or code is not judged.
    if (word.length < 3 || /[\d_]/.test(word) || /\p{Lu}/u.test(word) || known.has(word.toLowerCase())) return false;
    return !words.known(word);
  });
}

function nearTerm(text: string, terms: readonly Term[]): boolean {
  const said = new Set(wordsIn(text).map((word) => word.toLowerCase()));
  return terms.some((each) =>
    each.heard.some((form) => {
      const [first, ...rest] = form.toLowerCase().split(/\s+/);
      return first !== undefined && rest.length > 0 && first.length > 3 && said.has(first);
    }),
  );
}

export interface Gating {
  /** The rules' text, and whether the rules made a list of it. */
  text: string;
  listed: boolean;
  terms: readonly Term[];
  words: Words;
  /** The profile asks the model for every utterance. */
  polish: boolean;
}

/** Why the model should be asked; empty when it should not. */
export function gate({ text, listed, terms, words, polish }: Gating): GateReason[] {
  const reasons: GateReason[] = [];
  if (cued(text) || repeats(text)) reasons.push("cue");
  if (!listed && (text.match(LIST_MARKERS)?.length ?? 0) >= 2) reasons.push("list");
  if (runOn(text)) reasons.push("run-on");
  if (nonWord(text, terms, words)) reasons.push("non-word");
  if (nearTerm(text, terms)) reasons.push("near-term");
  if (polish && wordsIn(text).length > 2) reasons.push("polish");
  return reasons;
}
