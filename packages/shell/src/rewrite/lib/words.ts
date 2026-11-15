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

/** Words that can take back what came before them, in English and Spanish. */
const CUES = new Set(
  (
    "no not actually wait sorry scratch mean meant rather correction instead nevermind never " +
    "digo perdon mejor quise quiero corrijo espera miento borra olvidalo sea bueno ay"
  ).split(" "),
);

export const isCue = (word: string): boolean => CUES.has(word);

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
