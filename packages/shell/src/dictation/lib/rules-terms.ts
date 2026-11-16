/**
 * Names and terms (compose.ts, the first rules): what the recogniser gave
 * becomes what the person writes, by rule and with no model.
 *
 * - a replacement, or a vocabulary term's "heard as" form, said as whole
 *   words in any capitals, becomes the written form; the longest wins
 *   ("cloud code" → "Claude Code");
 * - a vocabulary term said in other capitals takes the term's ("siri" →
 *   "Siri");
 * - a word that is no word (the system's dictionary says) and is nearly a
 *   vocabulary term becomes it ("Whisperflow" → "Wispr Flow");
 * - a contraction that lost its ending gets it back ("shouldt" →
 *   "shouldn't", "I dot like" → "I don't like").
 *
 * The text keeps its spacing; only the words change.
 */

import type { Pair, Term } from "../types.ts";
import type { Words } from "../words.ts";
import { type Token, tokens } from "./tidy-tokens.ts";

export interface Lexical {
  terms: readonly Term[];
  replacements: readonly Pair[];
}

interface Phrase {
  words: string[];
  to: string;
}

const wordsOf = (text: string): string[] =>
  tokens(text)
    .filter((token) => token.word)
    .map((token) => token.text.toLowerCase());

/** Every phrase that is replaced, the longest first. */
function phrases({ terms, replacements }: Lexical): Phrase[] {
  const list: Phrase[] = [];
  for (const pair of replacements) list.push({ words: wordsOf(pair.from), to: pair.to });
  for (const { term, heard } of terms) {
    for (const form of heard) list.push({ words: wordsOf(form), to: term });
    // Its own capitals, where it has any ("siri" → "Siri"); a lower-case term is left as it was said.
    if (term !== term.toLowerCase()) list.push({ words: wordsOf(term), to: term });
  }
  return list.filter((phrase) => phrase.words.length > 0).sort((a, b) => b.words.length - a.words.length);
}

const POSSESSIVE = /['’]s$/i;

/** How many tokens `phrase` takes at `at` (its words, with nothing but spaces between), and a possessive to keep; null when it is not there. */
function matchAt(list: readonly Token[], at: number, phrase: Phrase): { length: number; tail: string } | null {
  let tail = "";
  for (const [nth, word] of phrase.words.entries()) {
    const token = list[at + nth];
    if (!token?.word) return null;
    let text = token.text.toLowerCase();
    if (nth === phrase.words.length - 1 && text !== word && POSSESSIVE.test(text)) {
      tail = token.text.slice(-2);
      text = text.slice(0, -2);
    }
    if (text !== word) return null;
  }
  return { length: phrase.words.length, tail };
}

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length] ?? 0;
}

/** How alike two words are, 0 to 1. */
export const likeness = (a: string, b: string): number => (a === b ? 1 : 1 - distance(a, b) / Math.max(a.length, b.length, 1));

/** At or above this a non-word is the term (OpenWhispr measured no false hit at 0.8 on common words; without a dictionary, be stricter). */
const NEAR = 0.8;
const NEAR_BLIND = 0.86;

/** The vocabulary term `word` nearly is, or null: only for a word no dictionary knows. */
export function nearTerm(word: string, terms: readonly Term[], words: Words): string | null {
  const said = word.toLowerCase();
  if (said.length < 4 || /\d/.test(said) || words.known(said)) return null;
  const floor = words.loaded ? NEAR : NEAR_BLIND;
  let best: { term: string; score: number } | null = null;
  for (const { term } of terms) {
    const flat = term.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (flat === said || Math.abs(flat.length - said.length) > 3) continue;
    const score = likeness(said, flat);
    if (score >= floor && (!best || score > best.score)) best = { term, score };
  }
  return best?.term ?? null;
}

/** Contractions the recogniser drops the ending of; none of the keys is a word. */
const CONTRACTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  ["do", "does", "did", "is", "are", "was", "were", "has", "have", "had", "would", "could", "should", "must"].flatMap((verb) => {
    const fixed = `${verb}n't`;
    const forms = [`${verb}nt`, ...(["would", "could", "should", "did", "does"].includes(verb) ? [`${verb}t`] : [])];
    return forms.map((form) => [form, fixed]);
  }),
);
/** "I dot like": after a pronoun and before a verb, "dot" is "don't". */
const PRONOUNS = new Set(["i", "you", "we", "they"]);
const VERBS = new Set("like want know think need have see care mind understand get believe feel remember mean".split(" "));

function contractionAt(list: readonly Token[], at: number): string | null {
  const token = list[at];
  if (!token?.word) return null;
  const said = token.text.toLowerCase();
  const fixed = CONTRACTIONS[said];
  if (fixed) return /^\p{Lu}/u.test(token.text) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
  const before = list[at - 1];
  const after = list[at + 1];
  if (said === "dot" && before?.word && after?.word && PRONOUNS.has(before.text.toLowerCase()) && VERBS.has(after.text.toLowerCase())) return "don't";
  return null;
}

const join = (list: readonly Token[]): string => list.map((token, index) => (token.gap && index > 0 ? " " : "") + token.text).join("");

/** The text with its names and terms as the person writes them, and how many were changed. */
export function applyTerms(text: string, lexical: Lexical, words: Words): { text: string; fixes: number } {
  const list = tokens(text);
  const rules = phrases(lexical);
  const out: Token[] = [];
  let fixes = 0;
  for (let at = 0; at < list.length; at++) {
    const token = list[at];
    if (!token) continue;
    if (!token.word) {
      out.push(token);
      continue;
    }
    let done = false;
    for (const phrase of rules) {
      const hit = matchAt(list, at, phrase);
      if (!hit) continue;
      const to = phrase.to + hit.tail;
      const was = join(list.slice(at, at + hit.length).map((each, nth) => (nth === 0 ? { ...each, gap: false } : each)));
      if (was !== to) fixes++;
      out.push({ text: to, word: true, gap: token.gap });
      at += hit.length - 1;
      done = true;
      break;
    }
    if (done) continue;
    const tail = POSSESSIVE.test(token.text) ? token.text.slice(-2) : "";
    const near = nearTerm(tail ? token.text.slice(0, -2) : token.text, lexical.terms, words);
    const fixed = near ? near + tail : contractionAt(list, at);
    if (fixed) fixes++;
    out.push(fixed ? { ...token, text: fixed } : token);
  }
  return { text: join(out), fixes };
}
