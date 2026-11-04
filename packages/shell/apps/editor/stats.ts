/** The footer's counts: lines, words, and characters (code points, so an emoji is one). */

export interface TextStats {
  lines: number;
  words: number;
  characters: number;
}

export function textStats(text: string): TextStats {
  if (text === "") return { lines: 0, words: 0, characters: 0 };
  let lines = 1;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lines++;
  // A file that ends with a newline does not have an empty last line.
  if (text.endsWith("\n")) lines--;
  const words = text.match(/\S+/g)?.length ?? 0;
  let characters = 0;
  for (const _ of text) characters++;
  return { lines, words, characters };
}

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** "12 lines · 80 words · 412 characters". */
export function formatStats(stats: TextStats): string {
  return [plural(stats.lines, "line", "lines"), plural(stats.words, "word", "words"), plural(stats.characters, "character", "characters")].join(" · ");
}
