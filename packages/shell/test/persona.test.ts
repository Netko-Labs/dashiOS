import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHARACTERS,
  COLOURS,
  characterFileText,
  checkCharacterFile,
  checkName,
  chooseCharacter,
  DASHI,
  hubPersona,
  makeCharacterFile,
  type PersonaSection,
  personaStyle,
  presetCharacter,
  previewLine,
  promptLanguage,
  readCharacters,
  resolvePersona,
  spokenContext,
  TAKEN_NAME,
} from "../src/persona/index.ts";
import { DEFAULT_PERSONA } from "../src/shared/pill/index.ts";
import { SPOKEN_CONTEXT } from "../src/voice/lib/answer.ts";

const view = (persona: PersonaSection, voice?: string) => resolvePersona({ persona, voice: voice ? { voice } : {} }, []);

test("no persona section: everything is as before", () => {
  const none = view({});
  expect(none.set).toBe(false);
  expect(hubPersona(none, "en")).toBe(DEFAULT_PERSONA);
  expect(personaStyle(none, "en")).toEqual({ full: "", small: "" });
  expect(spokenContext("normal")).toBe(SPOKEN_CONTEXT);
  // 0.8's voice choice is still told, and nothing else changes.
  expect(hubPersona(view({}, "bf_emma"), "en")).toEqual({ ...DEFAULT_PERSONA, voice: "bf_emma" });
});

test("names: one line of letters, never another assistant's", () => {
  expect(checkName("Miso")).toEqual({ ok: true, name: "Miso" });
  expect(checkName("  Señor  O'Dashi-2. ")).toEqual({ ok: true, name: "Señor O'Dashi-2." });
  expect(checkName("")).toEqual({ ok: true, name: "Dashi" });
  expect(checkName("Claude")).toEqual({ ok: false, why: TAKEN_NAME });
  expect(checkName("  siri ")).toEqual({ ok: false, why: TAKEN_NAME });
  expect(checkName("ChatGPT").ok).toBe(false);
  expect(checkName("a".repeat(25)).ok).toBe(false);
  expect(checkName("a".repeat(24)).ok).toBe(true);
  expect(checkName("Mi\nso").ok).toBe(false);
  expect(checkName("<b>").ok).toBe(false);
  // A refused name in the file is not worn.
  expect(view({ name: "Claude" }).name).toBe("Dashi");
});

test("the six characters: both languages, a known colour, a voice for each language", () => {
  expect(CHARACTERS.map((each) => each.id)).toEqual(["dashi", "miso", "kombu", "wasabi", "nori", "yuzu"]);
  for (const each of CHARACTERS) {
    expect(each.prompt.en.length).toBeGreaterThan(40);
    expect(each.prompt.es.length).toBeGreaterThan(40);
    expect(each.prompt.en.length).toBeLessThanOrEqual(600);
    expect(COLOURS.some((colour) => colour.id === each.colour)).toBe(true);
    expect(each.voice.en).toMatch(/^[ab][fm]_/);
    expect(each.voice.es).toMatch(/^e[fm]_/);
    expect(checkName(each.name)).toEqual({ ok: true, name: each.name });
  }
});

test("what the hub is told: the name, the colour's #rrggbb, the mark, how much it talks, the style", () => {
  const miso = view({ name: "Miso", character: "miso", colour: "#6f4d3c", mark: "dots", talk: "more", you: "Alex" }, "af_bella");
  const hub = hubPersona(miso, "en");
  expect(hub).toMatchObject({ name: "Miso", colour: "#6f4d3c", mark: "dots", talk: "more", voice: "af_bella" });
  expect(hub.prompt).toContain("Your name is Miso. You are the assistant of Dashi, the system of this computer.");
  expect(hub.prompt).toContain(presetCharacter("miso")?.prompt.en ?? "?");
  expect(hub.prompt).toContain("The person likes to be called Alex.");
  expect(hubPersona(miso, "es").prompt).toContain(presetCharacter("miso")?.prompt.es ?? "?");
  // A colour that is not one of the six is not worn: it could be ink, amber, green or red.
  expect(hubPersona(view({ name: "Miso", colour: "#f0b93c" }), "en").colour).toBe(DEFAULT_PERSONA.colour);
  // The model on this computer gets no character text and no note.
  const small = personaStyle(view({ character: "miso", note: "Short answers." }), "en").small;
  expect(small).not.toContain("kitchen");
  expect(small).not.toContain("Short answers.");
  expect(small).toContain("Answer in one or two short sentences.");
});

test("the prompt's language: the person's choice, else the region's, else English", () => {
  expect(promptLanguage("es", "en_US.UTF-8", undefined)).toBe("es");
  expect(promptLanguage("auto", "es_CO.UTF-8", "en_US.UTF-8")).toBe("es");
  expect(promptLanguage("auto", undefined, "es_ES.UTF-8")).toBe("es");
  expect(promptLanguage("auto", undefined, undefined)).toBe("en");
  expect(promptLanguage("en", "es_CO.UTF-8", undefined)).toBe("en");
});

test("the preview's line: fixed words, the name, and the person's name only when there is one", () => {
  expect(previewLine(view({ character: "miso", name: "Miso", you: "Alex" }), "en")).toBe("Hi, Alex. I'm Miso. Good to see you. What are we making today?");
  expect(previewLine(view({ character: "miso", name: "Pixel" }), "en")).toBe("Hi. I'm Pixel. Good to see you. What are we making today?");
  expect(previewLine(view({ character: "yuzu", name: "Yuzu" }), "es")).toBe("¡Hola! Aquí Yuzu. Vamos a sacar algo adelante.");
  expect(previewLine(view({ character: "kombu", name: "Kombu", you: "Alex" }), "en")).toBe("Kombu. Ready.");
});

test("choosing a character sets its look and talk at once; a name of the person's own stays", () => {
  const kombu = presetCharacter("kombu") ?? DASHI;
  const fromMiso = chooseCharacter(view({ character: "miso", name: "Miso" }), kombu, "en", [], ["bm_george", "af_heart"]);
  expect(fromMiso).toEqual({
    persona: { character: "kombu", talk: "less", colour: "#136770", mark: "dot", dots: "pearls", name: "Kombu" },
    voice: "bm_george",
  });
  const pixel = chooseCharacter(view({ character: "miso", name: "Pixel" }), kombu, "es", [], ["af_heart"]);
  expect(pixel.persona.name).toBeUndefined();
  // Its voice is not on this computer: the voice stays as it is.
  expect(pixel.voice).toBeUndefined();
});

test("a character file: good, another version, an unknown colour, a long prompt, too large, a preset's id", () => {
  const good = {
    dashiCharacter: 1,
    id: "abuela",
    name: "Abuela",
    prompt: { es: "Hablas como una abuela cariñosa." },
    colour: "berry",
    talk: "chatty",
    extra: 1,
  };
  const read = checkCharacterFile(JSON.stringify(good));
  if (!read.ok) throw new Error(read.why);
  expect(read.character).toMatchObject({ id: "abuela", name: "Abuela", colour: "berry", talk: "more", mark: "spark", own: true });
  // The language it lacks falls back to the one it has.
  expect(read.character.prompt.en).toBe("Hablas como una abuela cariñosa.");
  expect(checkCharacterFile(JSON.stringify({ ...good, dashiCharacter: 2 }))).toEqual({ ok: false, why: "it is for another version" });
  const odd = checkCharacterFile(JSON.stringify({ ...good, colour: "#ff0000", mark: "<svg/>" }));
  expect(odd.ok && odd.character.colour).toBe("violet");
  expect(odd.ok && odd.character.mark).toBe("spark");
  const long = checkCharacterFile(JSON.stringify({ ...good, prompt: { en: "a".repeat(700) } }));
  expect(long.ok && long.character.prompt.en.length).toBe(600);
  expect(checkCharacterFile(JSON.stringify({ ...good, about: { en: "x".repeat(9 * 1024) } }))).toEqual({ ok: false, why: "it is larger than 8 KB" });
  expect(checkCharacterFile(JSON.stringify({ ...good, id: "miso" }))).toEqual({ ok: false, why: "its id is one of Dashi's" });
  expect(checkCharacterFile(JSON.stringify({ ...good, name: "Claude" }))).toEqual({ ok: false, why: "its name is not allowed" });
  expect(checkCharacterFile(JSON.stringify({ ...good, prompt: {} }))).toEqual({ ok: false, why: "it has no prompt text" });
  expect(checkCharacterFile("not json")).toEqual({ ok: false, why: "it is not JSON" });
  for (const why of [
    "it is for another version",
    "it is larger than 8 KB",
    "its id is one of Dashi's",
    "its id is missing or wrong",
    "its name is not allowed",
  ]) {
    expect(why.split(" ").length).toBeLessThanOrEqual(6);
  }
});

test("the characters folder: Make a File writes a whole copy; a chosen file that is gone is Dashi until it is back", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "dashi-characters-")), "characters");
  expect(readCharacters(dir)).toEqual({ characters: [], refused: [] });
  const made = makeCharacterFile(presetCharacter("wasabi") ?? DASHI, dir);
  expect(made.id).toBe("my-character");
  expect(makeCharacterFile(DASHI, dir).id).toBe("my-character-2");
  expect(readFileSync(made.path, "utf8")).toBe(characterFileText(presetCharacter("wasabi") ?? DASHI, "my-character", "My character"));
  writeFileSync(join(dir, "wrong.json"), JSON.stringify({ dashiCharacter: 1, id: "other", name: "Other", prompt: { en: "Hi." } }));
  writeFileSync(join(dir, "notes.txt"), "not a character");
  const files = readCharacters(dir);
  expect(files.characters.map((each) => each.id)).toEqual(["my-character", "my-character-2"]);
  expect(files.refused).toEqual([{ file: "wrong.json", why: "its name is not its id" }]);
  const chosen = resolvePersona({ persona: { character: "my-character" }, voice: {} }, files.characters);
  expect(chosen.character.prompt.en).toBe(presetCharacter("wasabi")?.prompt.en ?? "?");
  expect(chosen.missing).toBeNull();
  const gone = resolvePersona({ persona: { character: "my-character" }, voice: {} }, []);
  expect(gone.character).toBe(DASHI);
  expect(gone.missing).toBe("my-character");
});

/** contrast.py's arithmetic (dashi-0.9.0-design/persona/src/contrast.py): WCAG 2 luminance and ratio. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const ratio = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("each colour keeps the design's contrast: white and quiet words 4.5, the amber disc 3, an edge on the lightest wallpaper 3", () => {
  const [white, amber, unsure, lightest, darkest] = ["#ffffff", "#f0b93c", "#ffd978", "#f2a044", "#1f1638"] as const;
  expect(COLOURS.map((each) => each.id)).toEqual(["violet", "blue", "teal", "moss", "berry", "cocoa"]);
  for (const colour of COLOURS) {
    for (const end of [colour.from, colour.to]) {
      expect(ratio(white, end)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(colour.soft, end)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(amber, end)).toBeGreaterThanOrEqual(3);
      expect(ratio(unsure, end)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(colour.deep, white)).toBeGreaterThanOrEqual(4.5);
    expect(Math.max(ratio(colour.to, lightest), ratio(white, lightest))).toBeGreaterThanOrEqual(3);
    expect(ratio(white, darkest)).toBeGreaterThanOrEqual(3);
  }
});
