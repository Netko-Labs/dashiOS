/**
 * Tidying's own check (tidy.ts): what is typed may differ from what was
 * heard only by words the rules may take out. It never has a word that was
 * not said, never has the words in another order, and never loses a number
 * or a "not" or a "no", except inside what the person took back themselves
 * ("no wait"), where the part taken back and the part that replaced it must
 * say "not" as often (and a sentence said again as often as the first time).
 * When this fails the words land as heard.
 */

import { wordsOf } from "./tidy-tokens.ts";
import { DROPPABLE, isNegation, isNumber } from "./tidy-words.ts";

export interface TakenBack {
  /** The words the person took back, and the phrase that did it. */
  struck: readonly string[];
  /** The words that replaced them. */
  kept: readonly string[];
  /** The phrase itself ("no", "wait"). */
  phrase: readonly string[];
  /** The whole sentence the phrase came after. */
  sentence: readonly string[];
}

function subsequence(short: readonly string[], long: readonly string[]): boolean {
  let at = 0;
  for (const word of long) if (at < short.length && short[at] === word) at++;
  return at === short.length;
}

function counts(words: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const word of words) map.set(word, (map.get(word) ?? 0) + 1);
  return map;
}

const negations = (words: readonly string[]): number => words.filter(isNegation).length;

export function keepsMeaning(heard: string, typed: string, takenBack: readonly TakenBack[] = []): boolean {
  const said = wordsOf(heard);
  const kept = wordsOf(typed);
  if (!subsequence(kept, said)) return false;
  const gone = counts(said);
  for (const word of kept) gone.set(word, (gone.get(word) ?? 0) - 1);
  for (const change of takenBack) {
    const struck = [...change.struck];
    // The phrase's own "no" is the command, not a "no" of the sentence.
    for (const word of change.phrase) {
      const at = struck.indexOf(word);
      if (at >= 0) struck.splice(at, 1);
      gone.set(word, (gone.get(word) ?? 0) - 1);
    }
    if (negations(struck) !== negations(change.kept)) return false;
    // More than a word or two replaced it: the sentence was said again, and must say "not" as often as it did.
    if (change.kept.length > 2 && negations(change.sentence) !== negations(change.kept)) return false;
    for (const word of struck) gone.set(word, (gone.get(word) ?? 0) - 1);
  }
  for (const [word, count] of gone) {
    if (count < 0) return false;
    if (count > 0 && (!DROPPABLE.has(word) || isNumber(word) || isNegation(word))) return false;
  }
  return true;
}
