/**
 * settings.json `persona` and `voice.voice`, and the characters folder, read into who Dashi is:
 * `PersonaView` for the pane and the prompt, and the hub's `Persona` for the capsule, the bar and
 * the voice loop (shared/pill/persona.ts). With no `persona` section everything is as before: the
 * hub's default, and no word added to the prompt.
 */

import {
  DEFAULT_PERSONA,
  isPersonaDots,
  isPersonaMark,
  isPersonaTalk,
  type Persona,
  type PersonaDots,
  type PersonaMark,
  type PersonaMotion,
  type PersonaSettings,
  type PersonaTalk,
} from "../../shared/pill/index.ts";
import { CHARACTERS, type Character, DASHI, presetCharacter } from "./characters.ts";
import { isPersonaLanguage, type PersonaLanguage } from "./language.ts";
import { checkName, NOTE_MAX, plainText, YOU_MAX } from "./name.ts";
import { type Colour, colourById, colourOfHex, VIOLET } from "./palette.ts";
import { promptBlocks } from "./prompt.ts";

/** settings.json `persona`: the keys the others count on, and the persona piece's own. */
export interface PersonaSection extends PersonaSettings {
  /** What it calls the person; none when empty. */
  you?: string;
  language?: string;
  /** The person's own words on how to talk to them. */
  note?: string;
}

export const isPersonaYou = (value: unknown): value is string => typeof value === "string" && value.length <= YOU_MAX && !/[\n\r\0]/.test(value);
export const isPersonaNote = (value: unknown): value is string => typeof value === "string" && value.length <= NOTE_MAX && !/[\n\r\0]/.test(value);

export interface PersonaView {
  /** False when settings.json has no persona section: draw and say everything as before. */
  set: boolean;
  name: string;
  you: string;
  note: string;
  /** The chosen character; Dashi while none is, or while the chosen file is gone or wrong. */
  character: Character;
  /** The chosen id that names no character now. */
  missing: string | null;
  talk: PersonaTalk;
  language: PersonaLanguage;
  colour: Colour;
  /** The `#rrggbb` the hub is given: the chosen colour's, else the agents' purple as before. */
  hex: string;
  mark: PersonaMark;
  dots: PersonaDots;
  /** The chosen character's way of moving its dots. */
  motion: PersonaMotion;
  /** `voice.voice`; undefined is Dashi's own. */
  voice: string | undefined;
}

export function resolvePersona(settings: { persona: PersonaSection; voice: { voice?: string } }, files: readonly Character[]): PersonaView {
  const held = settings.persona;
  const set = Object.values(held).some((value) => value !== undefined);
  const chosen = held.character;
  const character = chosen === undefined ? DASHI : (presetCharacter(chosen) ?? files.find((each) => each.id === chosen));
  const name = typeof held.name === "string" ? checkName(held.name) : null;
  return {
    set,
    name: name?.ok ? name.name : DEFAULT_PERSONA.name,
    you: typeof held.you === "string" ? plainText(held.you, YOU_MAX) : "",
    note: typeof held.note === "string" ? plainText(held.note, NOTE_MAX) : "",
    character: character ?? DASHI,
    missing: chosen !== undefined && character === undefined ? chosen : null,
    talk: isPersonaTalk(held.talk) ? held.talk : DEFAULT_PERSONA.talk,
    language: isPersonaLanguage(held.language) ? held.language : "auto",
    colour: colourOfHex(held.colour) ?? VIOLET,
    hex: colourOfHex(held.colour)?.to ?? DEFAULT_PERSONA.colour,
    mark: isPersonaMark(held.mark) ? held.mark : DEFAULT_PERSONA.mark,
    dots: isPersonaDots(held.dots) ? held.dots : DEFAULT_PERSONA.dots,
    motion: (character ?? DASHI).motion,
    voice: settings.voice.voice,
  };
}

/** The two blocks the prompt takes (lib/prompt.ts); both empty while no persona is set. */
export function personaStyle(view: PersonaView, language: "en" | "es"): { full: string; small: string } {
  if (!view.set) return { full: "", small: "" };
  return promptBlocks({
    name: view.name,
    character: view.character.prompt[language],
    talk: view.talk,
    language: view.language,
    you: view.you,
    note: view.note,
  });
}

/** What the capsule, the bar and the voice loop read. A colour that is not one of the six is not worn. */
export function hubPersona(view: PersonaView, language: "en" | "es"): Persona {
  if (!view.set) return view.voice === undefined ? DEFAULT_PERSONA : { ...DEFAULT_PERSONA, voice: view.voice };
  return {
    name: view.name,
    colour: view.hex,
    mark: view.mark,
    dots: view.dots,
    motion: view.motion,
    voice: view.voice,
    talk: view.talk,
    prompt: personaStyle(view, language).full,
  };
}

/** The line the preview says: fixed text, never a model's. `{you}` goes with its comma when there is none. */
export function previewLine(view: PersonaView, language: "en" | "es"): string {
  const line = view.character.hello[language];
  return (view.you ? line.replace("{you}", view.you) : line.replace(", {you}", "")).replace("{name}", view.name);
}

export interface CharacterChoice {
  persona: PersonaSection;
  /** `voice.voice` to set; undefined leaves the voice as it is (the character's is not installed). */
  voice: string | undefined;
}

/**
 * What choosing a character writes, as one change: the character and its own talk, colour, mark and dots,
 * its voice where that voice is here, and its name only while the name is still a character's (so
 * "Miso" follows to "Kombu" and "Pixel" stays "Pixel"). After that every row is the person's.
 */
export function chooseCharacter(
  view: PersonaView,
  to: Character,
  language: "en" | "es",
  files: readonly Character[],
  voices: readonly string[],
): CharacterChoice {
  const names = new Set([...CHARACTERS, ...files].map((each) => each.name));
  const follows = !view.set || names.has(view.name);
  const voice = to.voice[language];
  return {
    persona: {
      character: to.id,
      talk: to.talk,
      colour: (colourById(to.colour) ?? VIOLET).to,
      mark: to.mark,
      dots: to.dots,
      ...(follows ? { name: to.name } : {}),
    },
    voice: voices.includes(voice) ? voice : undefined,
  };
}
