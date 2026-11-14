/**
 * A person's own character: one small JSON file in `~/.config/dashi/characters/`, named `<id>.json`
 * (docs/decisions.md D56). It is the whole shareable thing, and it is text and ids only: no image,
 * no hex colour, no SVG, no voice file, no code. What it says goes into the prompt as the character's
 * text and nowhere else, so a file can change how Dashi sounds and looks and nothing it may do.
 *
 *   { "dashiCharacter": 1, "id": "abuela", "name": "Abuela",
 *     "about": { "en": "Fusses over you, then gets it done." },
 *     "prompt": { "en": "You speak like a loving grandmother…", "es": "Hablas como una abuela cariñosa…" },
 *     "talk": "normal", "colour": "berry", "mark": "spark", "voice": { "en": "af_heart", "es": "ef_dora" } }
 *
 * Only the person writes there: no agent tool does, and an agent's sandbox has the folder read-only
 * at most (test/persona-agents.test.ts).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { isCharacterId, isPersonaMark, isPersonaTalk, type PersonaTalk } from "../../shared/pill/index.ts";
import { settingsPath } from "../../shared/settings/index.ts";
import { type Character, DASHI, presetCharacter, type Words } from "./characters.ts";
import { checkName } from "./name.ts";
import { colourById } from "./palette.ts";
import { CHARACTER_TEXT_MAX, characterText } from "./prompt.ts";

/** A file larger than this is not read. */
export const FILE_MAX_BYTES = 8 * 1024;
export const ABOUT_MAX = 90;
/** How many files the folder is read for; more are left unread. */
export const FILES_MAX = 64;

/** Where the person's characters are kept, beside settings.json. */
export const charactersDir = (settings: string = settingsPath()): string => join(dirname(settings), "characters");

/** A file's id is not a preset's, and at most 24 characters. */
const isOwnId = (value: unknown): value is string => isCharacterId(value) && value.length <= 24 && presetCharacter(value) === undefined;

/** The words the design's files use for how much it talks, beside the store's own. */
const TALK_WORDS: Readonly<Record<string, PersonaTalk>> = { brief: "less", chatty: "more" };

const cut = (text: string, max: number): string => [...characterText(text)].slice(0, max).join("").trim();

function words(value: unknown, max: number): Words | null {
  if (!isRecord(value)) return null;
  const en = typeof value.en === "string" ? cut(value.en, max) : "";
  const es = typeof value.es === "string" ? cut(value.es, max) : "";
  if (en === "" && es === "") return null;
  return { en: en || es, es: es || en };
}

/** Why a file is not a character, in six words or fewer; the pane says "This file is not a character: …". */
export type FileCheck = { ok: true; character: Character } | { ok: false; why: string };

/** A file's text read as a character. Unknown keys are ignored; a look it does not name is Dashi's. */
export function checkCharacterFile(text: string): FileCheck {
  if (Buffer.byteLength(text, "utf8") > FILE_MAX_BYTES) return { ok: false, why: "it is larger than 8 KB" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, why: "it is not JSON" };
  }
  if (!isRecord(raw)) return { ok: false, why: "it is not JSON" };
  if (raw.dashiCharacter !== 1) return { ok: false, why: "it is for another version" };
  if (!isOwnId(raw.id)) return { ok: false, why: presetCharacter(raw.id) ? "its id is one of Dashi's" : "its id is missing or wrong" };
  const name = typeof raw.name === "string" ? checkName(raw.name) : null;
  if (!name?.ok || raw.name === "" || typeof raw.name !== "string" || raw.name.trim() === "") return { ok: false, why: "its name is not allowed" };
  const prompt = words(raw.prompt, CHARACTER_TEXT_MAX);
  if (!prompt) return { ok: false, why: "it has no prompt text" };
  const about = words(raw.about, ABOUT_MAX) ?? { en: "Your own character.", es: "Tu propio personaje." };
  const talk = typeof raw.talk === "string" ? (TALK_WORDS[raw.talk] ?? raw.talk) : undefined;
  const voice = isRecord(raw.voice) ? raw.voice : {};
  const voiceId = (value: unknown, fallback: string): string => (typeof value === "string" && /^[a-z]{2}_[a-z0-9]{1,24}$/.test(value) ? value : fallback);
  return {
    ok: true,
    character: {
      id: raw.id,
      name: name.name,
      about,
      prompt,
      hello: { en: "Hi, {you}. I'm {name}.", es: "Hola, {you}. Soy {name}." },
      colour: colourById(raw.colour)?.id ?? DASHI.colour,
      mark: isPersonaMark(raw.mark) ? raw.mark : DASHI.mark,
      talk: isPersonaTalk(talk) ? talk : DASHI.talk,
      voice: { en: voiceId(voice.en, DASHI.voice.en), es: voiceId(voice.es, DASHI.voice.es) },
      own: true,
    },
  };
}

export interface CharacterFiles {
  /** The good ones, by name. */
  characters: readonly Character[];
  /** The files that are not characters, and why. */
  refused: ReadonlyArray<{ file: string; why: string }>;
}

export const NO_FILES: CharacterFiles = { characters: [], refused: [] };

/** One file of the folder: it must be a plain file named after its id. */
function readOne(dir: string, file: string): FileCheck {
  const path = join(dir, file);
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { ok: false, why: "it is not a file" };
    if (stat.size > FILE_MAX_BYTES) return { ok: false, why: "it is larger than 8 KB" };
    const check = checkCharacterFile(readFileSync(path, "utf8"));
    if (check.ok && `${check.character.id}.json` !== file) return { ok: false, why: "its name is not its id" };
    return check;
  } catch {
    return { ok: false, why: "it cannot be read" };
  }
}

/** Every character in the folder. Never throws: no folder is no characters. */
export function readCharacters(dir: string = charactersDir()): CharacterFiles {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .sort()
      .slice(0, FILES_MAX);
  } catch {
    return NO_FILES;
  }
  const characters: Character[] = [];
  const refused: Array<{ file: string; why: string }> = [];
  for (const file of names) {
    const check = readOne(dir, file);
    if (check.ok) characters.push(check.character);
    else refused.push({ file, why: check.why });
  }
  characters.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { characters, refused };
}

/** A character as its file's text, every field filled, for the person to change. */
export function characterFileText(from: Character, id: string, name: string): string {
  const file = {
    dashiCharacter: 1,
    id,
    name,
    about: from.about,
    prompt: from.prompt,
    talk: from.talk,
    colour: from.colour,
    mark: from.mark,
    voice: from.voice,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** "Make a File": a copy of `from` as `my-character.json` (then `my-character-2.json`…); its path and id. The person's own press only (the pane asks). */
export function makeCharacterFile(from: Character, dir: string = charactersDir()): { path: string; id: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let id = "my-character";
  for (let n = 2; existsSync(join(dir, `${id}.json`)); n++) id = `my-character-${n}`;
  const path = join(dir, `${id}.json`);
  writeFileSync(path, characterFileText(from, id, "My character"), { flag: "wx", mode: 0o600 });
  return { path, id };
}
