/**
 * An instruction said as a whole utterance (landings.ts; research 1.9's
 * recommendation): "scratch that" and its kin take back Dashi's last
 * insertion; "new line" and "new paragraph" break the line. A short fixed
 * grammar in English and Spanish, not a guess: the same words inside a
 * longer sentence are words, and are typed.
 */

export type Instruction = { kind: "erase" } | { kind: "break"; text: string };

const ERASE: readonly string[] = [
  "scratch that",
  "delete that",
  "undo that",
  "remove that",
  "erase that",
  "remove the previous text",
  "delete the previous text",
  "remove previous text",
  "remove the last text",
  "delete the last text",
  "remove what i just said",
  "delete what i just said",
  "borra eso",
  "quita eso",
  "elimina eso",
  "deshaz eso",
  "borra lo anterior",
  "quita lo anterior",
  "borra el texto anterior",
  "quita el texto anterior",
];

const BREAKS: Readonly<Record<string, string>> = {
  "new line": "\n",
  "nueva línea": "\n",
  "nueva linea": "\n",
  "punto y aparte": "\n",
  "new paragraph": "\n\n",
  "nuevo párrafo": "\n\n",
  "nuevo parrafo": "\n\n",
};

/** Sounds and politeness round an instruction that do not make it a sentence. */
const AROUND = /^(?:(?:um+|uh+|eh|ok|okay|please|por favor)\s+)+|(?:\s+(?:please|por favor))+$/g;

/** The words alone: lower case, no marks, single spaces. */
const plain = (heard: string): string =>
  heard
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(AROUND, "")
    .trim();

/** The instruction `heard` is, when it is nothing else; null for words to type. */
export function instructionOf(heard: string): Instruction | null {
  const said = plain(heard);
  if (ERASE.includes(said)) return { kind: "erase" };
  const text = BREAKS[said];
  return text === undefined ? null : { kind: "break", text };
}
