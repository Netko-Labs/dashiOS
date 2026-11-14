/**
 * Who Dashi is, as the person made it (docs/decisions.md D53 to D57; Settings › Your Dashi): its
 * name, one of six characters or the person's own from a small file, how much it talks, the
 * language it answers in, and the colour and mark of its capsule. A character changes how Dashi
 * sounds and looks. It never changes what Dashi may do: nothing here is read by a permission, a
 * plan's step or a button, and what it adds to the prompt is only ever the middle
 * (agents/ask/answerer.ts `styledPrompt`).
 */

export { CHARACTERS, type Character, DASHI, presetCharacter, type Words } from "./lib/characters.ts";
export {
  type CharacterFiles,
  characterFileText,
  charactersDir,
  checkCharacterFile,
  FILE_MAX_BYTES,
  type FileCheck,
  makeCharacterFile,
  NO_FILES,
  readCharacters,
} from "./lib/files.ts";
export { isPersonaLanguage, LANGUAGES, type PersonaLanguage, promptLanguage } from "./lib/language.ts";
export { checkName, NAME_MAX, type NameCheck, NOTE_MAX, plainText, TAKEN_NAME, YOU_MAX } from "./lib/name.ts";
export { COLOUR_IDS, COLOURS, type Colour, type ColourId, colourById, colourOfHex, VIOLET } from "./lib/palette.ts";
export { CHARACTER_TEXT_MAX, characterText, OPEN, promptBlocks, spokenContext } from "./lib/prompt.ts";
export {
  type CharacterChoice,
  chooseCharacter,
  hubPersona,
  isPersonaNote,
  isPersonaYou,
  type PersonaSection,
  type PersonaView,
  personaStyle,
  previewLine,
  resolvePersona,
} from "./lib/resolve.ts";
export { type PersonaSource, startPersona } from "./start.ts";
