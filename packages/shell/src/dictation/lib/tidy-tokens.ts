/**
 * Words and marks (tidy.ts): what was heard, cut into words and single
 * marks, each remembering whether a space came before it, and put together
 * again with the spaces and capitals a sentence has.
 */

export interface Token {
  text: string;
  word: boolean;
  /** A space came before it. */
  gap: boolean;
  /** A mark tidying made from words said out loud ("comma"). */
  made?: true;
  /** A comma that took a full stop's place: the next word starts no sentence. */
  joined?: true;
}

const WORD = /[\p{L}\p{N}]+(?:[.,:'’/-][\p{L}\p{N}]+)*/uy;

export function tokens(text: string): Token[] {
  const out: Token[] = [];
  let at = 0;
  let gap = false;
  while (at < text.length) {
    WORD.lastIndex = at;
    const word = WORD.exec(text);
    if (word) {
      out.push({ text: word[0], word: true, gap });
      at += word[0].length;
      gap = false;
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(at) ?? 32);
    at += char.length;
    if (/\s/u.test(char)) gap = true;
    else {
      out.push({ text: char, word: false, gap });
      gap = false;
    }
  }
  return out;
}

/** The words alone, in lower case: what the check compares (tidy-check.ts). */
export const wordsOf = (text: string): string[] =>
  tokens(text)
    .filter((token) => token.word)
    .map((token) => token.text.toLowerCase());

export const isBreak = (token: Token | undefined): boolean => token !== undefined && !token.word && token.text.startsWith("\n");
/** A mark that ends a sentence, or a line break. */
export const ends = (token: Token | undefined): boolean => token !== undefined && !token.word && (/^[.!?…]$/.test(token.text) || isBreak(token));
const joins = (token: Token): boolean => !token.word && /^[,.;:!?…]$/.test(token.text);

/** A word the model began a sentence with, as it is inside one: "This" is "this"; "I", "I'm" and "NASA" stay. */
const unstart = (word: string): string => (/^\p{Lu}\p{Ll}+$/u.test(word) ? word.toLowerCase() : word);

/** Marks that met after words between them went: one comma, never ", ." or a mark leading a line. */
export function settle(list: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const token of list) {
    const before = out.at(-1);
    if (!joins(token) && !isBreak(token)) {
      out.push(before?.joined && token.word ? { ...token, text: unstart(token.text) } : token);
      continue;
    }
    // Nothing to close or join yet: a mark can't lead the text or a line.
    if (joins(token) && (before === undefined || isBreak(before))) continue;
    if (isBreak(token)) {
      // "Hello, new line": the comma has nothing to join.
      if (before && !before.word && /^[,;:]$/.test(before.text)) out.pop();
      out.push(token);
      continue;
    }
    if (before && joins(before) && (before.made || token.made || before.text === "," || token.text === ",")) {
      // Two marks where a word went: the one said out loud wins, then the stronger.
      const keep = before.made && !token.made ? before : token.made || before.text === "," ? token : before;
      // A full stop the model put after a comma said out loud is gone: the word after it starts no sentence.
      const dropped = keep === before ? token : before;
      out[out.length - 1] = { ...keep, gap: false, ...(ends(dropped) && !ends(keep) ? { joined: true as const } : {}) };
      continue;
    }
    out.push(token);
  }
  return out;
}

const OPENERS = /^[¿¡“«([]$/;

/** Whether a space goes before `token`: never before a mark that joins or around a line break; between words always; beside other marks, as it was. */
function spaceBefore(token: Token, before: Token | undefined): boolean {
  if (before === undefined || isBreak(before) || isBreak(token) || joins(token)) return false;
  if (!before.word && OPENERS.test(before.text)) return false;
  if (before.word && token.word) return true;
  if (joins(before)) return true;
  return token.gap;
}

/** The text again: no space before a mark or after a line break, capitals where a sentence starts. How many spaces and capitals changed. */
export function render(list: readonly Token[]): { text: string; spacing: number; capitals: number } {
  let text = "";
  let spacing = 0;
  let capitals = 0;
  let starts = true;
  list.forEach((token, index) => {
    const before = list[index - 1];
    const spaced = spaceBefore(token, before);
    if (spaced !== token.gap && index > 0) spacing++;
    let word = token.text;
    if (token.word && starts) {
      const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
      const upper = first.toLocaleUpperCase();
      if (upper !== first) {
        word = upper + word.slice(first.length);
        capitals++;
      }
    }
    if (token.word) starts = false;
    else if (ends(token)) starts = true;
    text += (spaced ? " " : "") + word;
  });
  return { text, spacing, capitals };
}
