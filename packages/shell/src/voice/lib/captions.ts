/**
 * What the chip's one line shows of words too long for it (docs/design.html,
 * "The voice chip"). Spoken sentences are cut into lines at word ends, and
 * the line that holds the word being said shows; what the person says shows
 * its end (the newest words), with "…" where the start was cut. Text is cut
 * here, by characters, never by the row growing or wrapping.
 */

/** The most characters one line holds, at the chip's widest. */
export const CAPTION_CHARS = 52;

export interface CaptionLine {
  /** The words of this line, in order. */
  words: readonly string[];
  /** Index of the line's first word in the sentence. */
  first: number;
}

/** A sentence's words cut into lines of at most `chars` (a word longer than that is a line by itself). */
export function captionLines(words: readonly string[], chars: number = CAPTION_CHARS): CaptionLine[] {
  const lines: Array<{ words: string[]; first: number; length: number }> = [];
  words.forEach((word, index) => {
    const line = lines.at(-1);
    if (line && line.length + 1 + word.length <= chars) {
      line.words.push(word);
      line.length += 1 + word.length;
    } else {
      lines.push({ words: [word], first: index, length: word.length });
    }
  });
  return lines.map(({ words: each, first }) => ({ words: each, first }));
}

/** The line that holds word `at`, with how many of its words are said (`said`, at least one once it shows). */
export function lineAt(lines: readonly CaptionLine[], at: number): { line: CaptionLine; said: number } | null {
  const line = lines.findLast((each) => each.first <= at) ?? lines[0];
  return line ? { line, said: Math.min(line.words.length, Math.max(0, at - line.first + 1)) } : null;
}

/** The end of `text` that fits `chars`, cut at a word's start, "…" first when anything was cut. */
export function tail(text: string, chars: number = CAPTION_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if ([...clean].length <= chars) return clean;
  const kept = [...clean].slice(-(chars - 1)).join("");
  const space = kept.indexOf(" ");
  // One long word: its end, cut where it must be.
  return `…${space >= 0 && space < kept.length - 1 ? kept.slice(space + 1) : kept}`;
}

/** The start of `text` that fits `chars`, cut at a word's end, "…" last when anything was cut. */
export function head(text: string, chars: number = CAPTION_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if ([...clean].length <= chars) return clean;
  const kept = [...clean].slice(0, chars - 1).join("");
  const space = kept.lastIndexOf(" ");
  return `${space > 0 ? kept.slice(0, space) : kept}…`;
}

/** Parakeet's own languages (docs/voice.md): a listen in one of them names none, so any of the 25 is heard. */
const PARAKEET = new Set("bg cs da de el en es et fi fr hr hu it lt lv mt nl pl pt ro ru sk sl sv uk".split(" "));

/** The `language` a listen names for a session in `locale` ("ja_JP.UTF-8"): only one Parakeet lacks (Whisper hears it). */
export function listenLanguage(locale: string | undefined): string | undefined {
  const language = (locale ?? "").split(/[_.@-]/)[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,3}$/.test(language) && !PARAKEET.has(language) ? language : undefined;
}
