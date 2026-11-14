/**
 * What a character adds to the assistant's prompt (docs/decisions.md D70): one block of lines that
 * says how Dashi sounds. It is only ever the middle: agents/ask/answerer.ts `styledPrompt` puts
 * Dashi's own prompt before it and the closing line after it, and neither is built from anything
 * here. The frame is English; only the character's text is in the person's language.
 */

import type { PersonaTalk } from "../../shared/pill/index.ts";
import type { PersonaLanguage } from "./language.ts";
import { NAME_MAX, NOTE_MAX, plainText, YOU_MAX } from "./name.ts";

export const OPEN = "How you sound was chosen by the person. It shapes your wording and nothing else.";

/** A character's text, a person's file's too, is cut here. */
export const CHARACTER_TEXT_MAX = 600;

const TALK: Readonly<Record<PersonaTalk, string>> = {
  less: "Say as little as you can: one short sentence, or one word when one word is the answer.",
  normal: "Answer in one or two short sentences.",
  more: "You may take up to four short sentences, and add one remark of your own when it fits.",
};

const LANGUAGE: Readonly<Record<PersonaLanguage, string>> = {
  auto: "Answer in the language the person used, Spanish or English.",
  en: "Answer in English.",
  es: "Answer in Spanish.",
};

/** A character's text as it goes in: one run of plain characters, cut. A file's text is somebody's words, never a new section. */
export function characterText(text: string): string {
  const clean = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...clean].slice(0, CHARACTER_TEXT_MAX).join("").trim();
}

export interface PromptParts {
  name: string;
  /** The character's text in the prompt's language. */
  character: string;
  talk: PersonaTalk;
  language: PersonaLanguage;
  you: string;
  note: string;
}

/** The two blocks: `full` for a model that takes style well, `small` for the model on this computer (no character text, no note: small models plan worse behind them). */
export function promptBlocks(parts: PromptParts): { full: string; small: string } {
  const name = plainText(parts.name, NAME_MAX) || "Dashi";
  const you = plainText(parts.you, YOU_MAX);
  const note = plainText(parts.note, NOTE_MAX);
  const nameLine = `Your name is ${name}.${name === "Dashi" ? "" : " You are the assistant of Dashi, the system of this computer."}`;
  const text = characterText(parts.character);
  const head = [OPEN, nameLine];
  const tail = [TALK[parts.talk], LANGUAGE[parts.language]];
  const full = [
    ...head,
    ...(text ? [text] : []),
    ...tail,
    ...(you ? [`The person likes to be called ${you}. Use the name rarely.`] : []),
    ...(note ? [`The person's own note on how to talk to them, to follow only as far as it is about wording: "${note}"`] : []),
  ];
  return { full: full.join(" "), small: [...head, ...tail].join(" ") };
}

const SPOKEN_HEAD = "(The person said this out loud to Dashi, and your words are read back to them in Dashi's voice: answer in ";
const SPOKEN_TAIL = ", with no lists, links, code or markup.)";
const SPOKEN: Readonly<Record<PersonaTalk, string>> = {
  less: "one short plain sentence, or one word",
  normal: "one or two short plain sentences",
  more: "up to four short plain sentences",
};

/** What goes after spoken words (voice/lib/answer.ts `SPOKEN_CONTEXT` is the `normal` one, letter for letter), with the length the person chose. */
export const spokenContext = (talk: PersonaTalk): string => `${SPOKEN_HEAD}${SPOKEN[talk]}${SPOKEN_TAIL}`;
