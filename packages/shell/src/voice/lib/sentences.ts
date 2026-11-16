/**
 * Words cut into sentences for speech, as they come: an answer is spoken a
 * sentence at a time, each handed to `speak` when it is whole, so the first
 * is heard while the rest is still being written. Nothing is ever dropped:
 * what is left when the words end is the last sentence, however long.
 */

/** Short words that end in a full stop without ending a sentence. */
const ABBREVIATIONS = /(?:\b(?:mr|mrs|ms|dr|sr|sra|st|vs|etc|e\.g|i\.e|no|approx)|\b[A-Za-z])\.$/i;

/** Marks a model writes for the eye: none of them is said. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*_`]+/g, "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Where the first whole sentence of `text` ends (the index after it), or -1 when none has ended yet. */
function sentenceEnd(text: string): number {
  const paragraph = text.search(/\n\s*\n/);
  const stop = /[.!?…]+["”’')\]]*(?=\s)/g;
  for (let found = stop.exec(text); found; found = stop.exec(text)) {
    const end = found.index + found[0].length;
    if (paragraph >= 0 && paragraph < end) break;
    // "3.5", "e.g. this", "Dr. Kim": not an end.
    if (found[0].startsWith(".") && ABBREVIATIONS.test(text.slice(0, found.index + 1))) continue;
    return end;
  }
  return paragraph >= 0 ? paragraph : -1;
}

/** Takes words as they are written and gives back each sentence once it is whole. */
export class SentenceCutter {
  private rest = "";

  /** More words: the sentences they complete, in order. */
  push(text: string): string[] {
    this.rest += text;
    const whole: string[] = [];
    for (let end = sentenceEnd(this.rest); end >= 0; end = sentenceEnd(this.rest)) {
      const sentence = speakable(this.rest.slice(0, end));
      this.rest = this.rest.slice(end).replace(/^\s+/, "");
      if (sentence) whole.push(sentence);
    }
    return whole;
  }

  /** The words ended: what is left is the last sentence. */
  end(): string[] {
    const last = speakable(this.rest);
    this.rest = "";
    return last ? [last] : [];
  }
}

/** Every sentence of `text`, none left out. */
export function sentencesOf(text: string): string[] {
  const cutter = new SentenceCutter();
  return [...cutter.push(`${text}\n\n`), ...cutter.end()];
}
