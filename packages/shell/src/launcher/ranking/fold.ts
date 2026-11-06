/**
 * Text as the ranking compares it: case and accents folded ("Écran" is
 * "ecran"), letters that don't decompose spelled out (ß is ss), and only
 * letters and digits kept, so "Wi-Fi", "wi fi" and "wifi" are one word. Each
 * folded string remembers where its words start, from spaces and
 * punctuation and from camel case ("GitHub" starts at G and H), which is
 * what word-start, acronym and fuzzy matches look for.
 */

/** Letters NFKD leaves whole (lowercase), spelled the way people type them without the key. */
const SPELLED: ReadonlyMap<string, string> = new Map([
  ["ß", "ss"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["ø", "o"],
  ["đ", "d"],
  ["ð", "d"],
  ["ł", "l"],
  ["ı", "i"],
  ["þ", "th"],
]);

const MARKS = /\p{M}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;

/** One character folded: lowercase, without marks; "" for marks themselves. */
function foldChar(char: string): string {
  const lower = char.toLowerCase();
  return SPELLED.get(lower) ?? lower.normalize("NFKD").replace(MARKS, "").toLowerCase();
}

/** Case and accents folded, the text otherwise as it was ("Écran d'accueil" is "ecran d'accueil"). */
export function fold(text: string): string {
  let out = "";
  for (const char of text) out += foldChar(char);
  return out;
}

/** A string ready to be matched: its letters and digits, folded, and where its words start. */
export interface Folded {
  /** Folded letters and digits only ("wifi" for "Wi-Fi"). */
  text: string;
  /** 1 where a word starts in `text`. */
  starts: Uint8Array;
  /** Which word each character of `text` is in, counting from 0. */
  word: Uint16Array;
  /** The words, as slices of `text`. */
  words: string[];
  /** The first letter of each word ("ss" for System Settings). */
  initials: string;
  /** The letters it has, as bits (charMask), for a quick no. */
  mask: number;
  /** The letters its words start with, as bits: a match that isn't inside a word or a typo starts with one. */
  startMask: number;
  /** What a typo is measured against: each word, and the whole when there are several. */
  typoWords: string[];
}

/**
 * `text` folded and compacted, with its word starts. A word starts after
 * anything that is not a letter or digit, at a capital after a small letter
 * (Git|Hub), and at the last capital of a run before a small one (VS|Code).
 */
export function prepare(text: string): Folded {
  const chars = [...text];
  let out = "";
  const starts: number[] = [];
  const words: string[] = [];
  let current = "";
  let previous = "";
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    if (!LETTER_OR_DIGIT.test(char)) {
      previous = "";
      continue;
    }
    const folded = foldChar(char);
    if (!folded) continue;
    const next = chars[i + 1] ?? "";
    const camel = UPPER.test(char) && (LOWER.test(previous) || (UPPER.test(previous) && LOWER.test(next)));
    if (previous === "" || camel) {
      if (current) words.push(current);
      current = "";
      starts.push(out.length);
    }
    out += folded;
    current += folded;
    previous = char;
  }
  if (current) words.push(current);
  const startFlags = new Uint8Array(out.length);
  const word = new Uint16Array(out.length);
  for (const start of starts) startFlags[start] = 1;
  let index = -1;
  for (let i = 0; i < out.length; i++) {
    if (startFlags[i]) index++;
    word[i] = Math.max(index, 0);
  }
  const initials = words.map((each) => each[0]).join("");
  return {
    text: out,
    starts: startFlags,
    word,
    words,
    initials,
    mask: charMask(out),
    startMask: charMask(initials),
    typoWords: words.length > 1 ? [out, ...words] : words,
  };
}

/** A bit per letter a–z, one for digits and one for anything else: what a string can match at most. */
export function charMask(text: string): number {
  let mask = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
    else if (code >= 48 && code <= 57) mask |= 1 << 26;
    else mask |= 1 << 27;
  }
  return mask;
}

/** How many set bits `mask` has. */
export function bitCount(mask: number): number {
  let value = mask - ((mask >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
