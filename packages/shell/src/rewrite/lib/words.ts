/** Words, numbers and the phrases that take words back, as the checks read them (checks.ts). */

/** The words of a text: lower case, no accents, no marks; "don't" is one word. */
export function wordsOf(text: string): string[] {
  const plain = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/’/g, "'");
  return plain.match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
}

const NUMBER_WORDS = new Set(
  (
    "zero two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen " +
    "twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million " +
    "cero dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve " +
    "veinte treinta cuarenta cincuenta sesenta setenta ochenta noventa cien ciento doscientos trescientos cuatrocientos quinientos mil millon"
  ).split(" "),
);

/** A number, in figures or in words ("one", "uno" and "una" are left out: they are mostly not numbers). */
export const isNumber = (word: string): boolean => /\d/.test(word) || NUMBER_WORDS.has(word);

/** The same number in English and Spanish: "no, I mean six" may be typed "seis" where the sentence is Spanish. */
const NUMBER_PAIRS: readonly (readonly [string, string])[] = [
  ["two", "dos"],
  ["three", "tres"],
  ["four", "cuatro"],
  ["five", "cinco"],
  ["six", "seis"],
  ["seven", "siete"],
  ["eight", "ocho"],
  ["nine", "nueve"],
  ["ten", "diez"],
  ["eleven", "once"],
  ["twelve", "doce"],
  ["twenty", "veinte"],
  ["thirty", "treinta"],
  ["hundred", "cien"],
  ["thousand", "mil"],
];
const OTHER_TONGUE = new Map(NUMBER_PAIRS.flatMap(([en, es]) => [[en, es] as const, [es, en] as const]));

/** The same word, one slip apart, or the same number in the other language. */
export const same = (a: string, b: string): boolean => near(a, b) || OTHER_TONGUE.get(a) === b;

/** "don't", "shouldn't", and the same with its ending lost in recognition ("dont", "shouldt"): a "not" that is never a cue. */
export const isNot = (word: string): boolean =>
  /n't$/.test(word) ||
  /^(?:do|does|did|is|are|was|were|has|have|had|ca|wo|should|would|could|must)nt$/.test(word) ||
  /^(?:should|would|could|does|must)t$/.test(word);

/** Words that can take back what came before them, in English and Spanish. */
const CUES = new Set(
  (
    "no not actually wait sorry scratch mean meant rather correction instead nevermind never " +
    "digo perdon mejor quise quiero corrijo espera miento borra olvidalo sea bueno ay"
  ).split(" "),
);

export const isCue = (word: string): boolean => CUES.has(word);

/** Words that go with a cue or mean nothing, so the final version may lack them ("scratch that", "quise decir", "um"). */
const WITH_CUE = new Set(
  "that mind decir dicho eso i yo make it lo um uh uhm eh ehm er erm hm hmm mm este like well bueno pues o or yes si was era eran".split(" "),
);

/** Whether a word may go with nothing said about it: a filler, or a word that only goes with a cue. */
export const isAside = (word: string): boolean => WITH_CUE.has(word);

/**
 * The cue a transcript opens with, if it opens with one ("No, thank you", "Actually, that works", "I mean, fine"):
 * nothing was said before it, so it takes nothing back and is what the speaker means.
 */
export function openingCue(said: readonly string[]): string | null {
  for (const word of said) {
    if (isCue(word)) return word;
    if (!WITH_CUE.has(word)) return null;
  }
  return null;
}

/**
 * The words said after the last cue: the final version, which a rewrite must keep. Empty when no cue was said.
 * ("at five, no, I mean six": "six". A rewrite that says "at five" kept the version that was taken back.)
 */
export function finalWords(said: readonly string[]): string[] {
  const last = said.findLastIndex(isCue);
  return last < 0 ? [] : said.slice(last + 1).filter((word) => !WITH_CUE.has(word));
}

/** Whether two words are the same but for a slip: one letter changed, added or dropped (longer words only). */
export function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return endA - start <= 1 && endB - start <= 1;
}
