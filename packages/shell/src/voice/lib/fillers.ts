/**
 * What a few words heard say of the person (docs/voice.md, "Fillers"): a sound made while thinking ("um", "uh") tells no
 * language and asks nothing, and a short utterance tells too little to change the conversation's language. Only the
 * languages the person has turned on (tongues.ts, D160) are ever chosen: "Um" was told as Portuguese (D197).
 */

import { tongueOf } from "../tongues.ts";

/** Sounds made while thinking, in English and Spanish: never a word of their own. */
const SOUNDS = new Set("um umm uhm uh uhh uh-uh eh ehm ah er erm hm hmm mm mmm mhm".split(" "));
/** A nod: alone it keeps the floor, unless Dashi had just asked something, when it is the answer. */
const NODS = new Set("ok okay vale".split(" "));
/** Fewer real words than this tell no language: "OK.", "Sí, claro." keep the conversation's. */
const SURE_WORDS = 3;

const wordsOf = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) ?? [];
const real = (words: readonly string[]): string[] => words.filter((word) => !SOUNDS.has(word) && !NODS.has(word));

/** The words are only sounds and nods ("Um.", "Uh uh.", "Okay."): `nodsAnswer` when Dashi's last words asked something. */
export function fillerOnly(text: string, nodsAnswer = false): boolean {
  const words = wordsOf(text);
  if (words.length === 0) return false;
  return words.every((word) => SOUNDS.has(word) || (!nodsAnswer && NODS.has(word)));
}

/** The conversation's language, kept across what was heard: the last one the words told with confidence. */
export class KeptTongue {
  private last: string | undefined;

  /** `on`: the codes of the languages turned on ("en", "es"). */
  constructor(private readonly on: () => readonly string[]) {}

  get language(): string | undefined {
    return this.last;
  }

  /**
   * The language `text` is answered in, from what the service `told` ("pt" for "Um."): told when it is turned on and the
   * words are enough to tell it; else the last confident one; else, at the start, told if it is turned on.
   */
  tell(text: string, told: string | undefined): string | undefined {
    const allowed = told !== undefined && this.on().includes(tongueOf(told));
    if (allowed && real(wordsOf(text)).length >= SURE_WORDS) this.last = told;
    return this.last ?? (allowed ? told : undefined);
  }
}
