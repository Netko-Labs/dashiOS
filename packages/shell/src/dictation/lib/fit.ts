/**
 * Fitting the words to the field (land.ts; research 3.1, stage 4): with
 * the text before and after the caret (AT-SPI, the walk the password check
 * uses), the words get a space before them or not, a capital or not, a
 * full stop or not, and a space after them or not, so they continue what
 * is there. Where the field can't be read they land as they always did:
 * as said, with a space after.
 */

import type { FieldRead } from "../types.ts";
import type { Words } from "../words.ts";

export interface Fitted {
  /** The words, as they fit. */
  text: string;
  /** What is typed: the words with the space before and after them. */
  typed: string;
}

export interface Fitting {
  words: Words;
  /** Names the vocabulary writes with a capital, in lower case: never lower-cased. */
  names: ReadonlySet<string>;
}

/** After one of these the words join with no space. */
const OPENERS = /[\s([{"'“‘«¿¡/@#_`-]$/u;
/** Before one of these no space is typed after the words, and a full stop of ours would be one too many. */
const CLOSERS = /^[\s.,;:!?)\]}"'”’»…]/u;
const ENDS_SENTENCE = /[.!?…]["'”’)\]]*$/u;

/** The line the caret is on, up to the caret. */
const lineBefore = (before: string): string => before.slice(before.lastIndexOf("\n") + 1);

/** Whether the words continue a sentence that is already begun before the caret. */
export function continues(before: string): boolean {
  const line = lineBefore(before).trimEnd();
  if (line === "") return false;
  // After a colon the words are left as they were said: a list, a quote or a sentence may follow.
  return !ENDS_SENTENCE.test(line) && !line.endsWith(":");
}

/** The first word in lower case when it is an ordinary word that only started a sentence. */
function lowerFirst(text: string, { words, names }: Fitting): string {
  const first = /^\p{Lu}\p{Ll}+(?=$|[^\p{L}\p{N}'’])/u.exec(text)?.[0];
  if (!first || names.has(first.toLowerCase())) return text;
  // A name the dictionary knows only with its capital stays ("Alex"); with no dictionary, only the vocabulary's names do.
  if (words.loaded && !words.common(first)) return text;
  return first.toLowerCase() + text.slice(first.length);
}

export function fit(text: string, field: Pick<FieldRead, "before" | "after"> | null, fitting: Fitting): Fitted {
  const trail = text.endsWith("\n") ? "" : " ";
  if (!field || field.before === null) return { text, typed: `${text}${trail}` };
  const { before } = field;
  const after = field.after ?? "";
  let words = text;
  if (continues(before)) words = lowerFirst(words, fitting);
  // Text follows on the same line: the words go into a sentence, which has its own end.
  const follows = after !== "" && !after.startsWith("\n");
  if (follows && /[^.]\.$/.test(words) && /^\s*[\p{L}\p{N},;:.]/u.test(after)) words = words.slice(0, -1);
  const lead = before === "" || OPENERS.test(before) || /^[\n.,;:!?)\]]/.test(words) ? "" : " ";
  const space = words.endsWith("\n") || (follows && CLOSERS.test(after)) ? "" : " ";
  return { text: words, typed: `${lead}${words}${space}` };
}
