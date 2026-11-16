/**
 * The languages Dashi speaks beside its voice's own (voice/tongues.ts; docs/voice.md, "A voice for
 * each language"): which are spoken and by whom, what `speak` is sent with, and the rows of
 * Settings › Voice that choose them.
 */

import { expect, test } from "bun:test";
import { tongueChoices } from "../src/settings-app/lib/panes/voice-languages.tsx";
import { startVoice } from "../src/voice/start.ts";
import { isVoiceMap, speakExtras, spokenTongues, tagOf, tongueOf, withTongue } from "../src/voice/tongues.ts";
import type { SpokenVoice, VoiceSettings } from "../src/voice/types.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

const voice = (id: string, language: string, pairs: Record<string, string> = {}, installed = true): SpokenVoice => ({
  id,
  name: `${id[3]?.toUpperCase()}${id.slice(4)}`,
  language,
  language_name: language,
  installed,
  pairs,
});

const VOICES: SpokenVoice[] = [
  voice("af_heart", "en-US", { es: "ef_dora", fr: "ff_siwis", pt: "pf_dora" }),
  voice("bm_george", "en-GB", { es: "em_alex", fr: "ff_siwis", pt: "pm_alex" }),
  voice("ef_dora", "es", { en: "af_heart", fr: "ff_siwis" }),
  voice("em_alex", "es", { en: "am_fenrir" }),
  voice("ff_siwis", "fr"),
  voice("pf_dora", "pt-BR", {}, false),
];

const spoken = (settings: VoiceSettings, own = "af_heart"): Array<[string, string | null]> =>
  spokenTongues(settings, VOICES, own).map((tongue) => [tongue.code, tongue.voice]);

test("Spanish is spoken by the voice's pair until the person says otherwise; a language with no voice here is not offered", () => {
  // Portuguese's voice is not installed: no row. French is off until turned on.
  expect(spoken({})).toEqual([
    ["es", "ef_dora"],
    ["fr", null],
  ]);
  expect(spoken({}, "bm_george")).toEqual([
    ["es", "em_alex"],
    ["fr", null],
  ]);
  // A Spanish voice: English is the other language, by its pair; a pair that is not here, the language's first.
  expect(spoken({}, "ef_dora")[0]).toEqual(["en", "af_heart"]);
  expect(spoken({}, "em_alex")).toEqual([
    ["en", "af_heart"],
    ["fr", null],
  ]);
  expect(spoken({ voices: { es: "em_alex", fr: "ff_siwis" } })).toEqual([
    ["es", "em_alex"],
    ["fr", "ff_siwis"],
  ]);
  expect(spoken({ voices: { es: false } })[0]).toEqual(["es", null]);
  // A voice that is gone, or of another language: the pair again.
  expect(spoken({ voices: { es: "ef_gone" } })[0]).toEqual(["es", "ef_dora"]);
  expect(spoken({ voices: { es: "ff_siwis" } })[0]).toEqual(["es", "ef_dora"]);
});

test("turning a language on keeps its voice; off is remembered for the usual two and forgotten for the rest", () => {
  expect(withTongue({}, "fr", "ff_siwis")).toEqual({ fr: "ff_siwis" });
  expect(withTongue({ voices: { fr: "ff_siwis" } }, "fr", null)).toBeUndefined();
  expect(withTongue({ voices: { fr: "ff_siwis" } }, "es", null)).toEqual({ fr: "ff_siwis", es: false });
  expect(withTongue({ voices: { es: false } }, "es", "em_alex")).toEqual({ es: "em_alex" });
  expect(isVoiceMap({ es: "ef_dora", en: false })).toBe(true);
  for (const wrong of [{ es: "../x" }, { ja: "jf_alpha" }, { es: true }, ["ef_dora"], null, "ef_dora"]) expect(isVoiceMap(wrong)).toBe(false);
});

test("Spanish is read as the person's region says it, Latin American where the formats are not Spanish", () => {
  expect(tagOf("es", "es_CO.UTF-8")).toBe("es-CO");
  expect(tagOf("es", "es_ES.UTF-8")).toBe("es-ES");
  expect(tagOf("es", "en_US.UTF-8")).toBe("es-419");
  expect(tagOf("es", undefined)).toBe("es-419");
  expect(tagOf("fr", "es_CO.UTF-8")).toBe("fr");
  expect(tongueOf("pt-BR")).toBe("pt");
  expect(tongueOf("es_CO.UTF-8")).toBe("es");
});

test("speak is sent the voices that may speak and the conversation's language", () => {
  expect(speakExtras({}, VOICES, "af_heart", { formats: "en_US.UTF-8" })).toEqual({ voices: { "es-419": "ef_dora" }, hint: "en" });
  // What the person last spoke wins over the language they chose for Dashi, which wins over the formats.
  expect(speakExtras({}, VOICES, "af_heart", { formats: "en_US.UTF-8", persona: "es" }).hint).toBe("es");
  expect(speakExtras({}, VOICES, "af_heart", { formats: "es_CO.UTF-8", persona: "auto", heard: "en" })).toEqual({ voices: { "es-CO": "ef_dora" }, hint: "en" });
  expect(speakExtras({ voices: { fr: "ff_siwis", es: false } }, VOICES, "af_heart", {})).toEqual({ voices: { fr: "ff_siwis" } });
  // A Spanish voice says its own language by the region too.
  expect(speakExtras({}, VOICES, "ef_dora", { formats: "es_MX.UTF-8" })).toEqual({ voices: { "es-MX": "ef_dora", en: "af_heart" }, hint: "es" });
  // Off: one voice, and nothing else to say about it.
  expect(speakExtras({ byLanguage: false }, VOICES, "af_heart", { heard: "es" })).toEqual({ byLanguage: false });
  // The voices are not known yet (the service has not answered): the service's own pairs do.
  expect(speakExtras({}, [], "af_heart", { heard: "es" })).toEqual({});
});

test("a language's row offers its voices by name, the accent where it has two, and Off", () => {
  const [spanish] = spokenTongues({}, VOICES, "af_heart");
  if (!spanish) throw new Error("no Spanish");
  expect(tongueChoices(spanish)).toEqual([
    { value: "ef_dora", label: "Dora" },
    { value: "em_alex", label: "Alex" },
    { value: "off", label: "Off" },
  ]);
  const [english] = spokenTongues({}, VOICES, "ef_dora");
  if (!english) throw new Error("no English");
  expect(tongueChoices(english).map((choice) => choice.label)).toEqual(["Heart · US", "George · GB", "Off"]);
});

function started(settings: VoiceSettings, region?: string) {
  const fake = fakeVoice({ voices: { default: "af_heart", voices: VOICES }, models: { fetching: false, sets: [] }, speak: { id: 1 } });
  const sent: Array<Record<string, unknown>> = [];
  fake.replies.speak = (params: Record<string, unknown>) => {
    sent.push(params);
    return { id: sent.length };
  };
  const parts = startVoice({
    settings: { getSnapshot: () => ({ data: { voice: settings, ...(region ? { region: { formats: region } } : {}) } }), subscribe: () => () => {} },
    hold: () => {},
    asker: { ask: async () => ({ say: "" }) },
    go: () => {},
    connect: async () => fake.link,
  });
  return { fake, sent, parts };
}

test("an answer is sent with the voices and the language last heard; a sample is said in its one voice", async () => {
  const { fake, sent, parts } = started({ on: true }, "es_CO.UTF-8");
  await parts.models.refresh();
  parts.voice.say("Está en la carpeta de descargas.");
  await settle();
  expect(sent[0]).toEqual({ text: "Está en la carpeta de descargas.", queue: true, voices: { "es-CO": "ef_dora" }, hint: "es" });
  // The person spoke English: the next answer's first words are taken as English.
  fake.emit({ event: "heard", text: "open the calendar", language: "en" });
  parts.voice.say("OK.");
  await settle();
  expect(sent[1]).toMatchObject({ text: "OK.", hint: "en" });
  parts.sample("em_alex");
  await settle();
  expect(sent[2]).toEqual({ text: "Hola, soy Dashi.", queue: true, voice: "em_alex", language: "es-CO" });
  expect(sent[3]).toEqual({ text: "Así es como sueno.", queue: true, voice: "em_alex", language: "es-CO" });
  parts.sample("bm_george");
  await settle();
  expect(sent[4]).toMatchObject({ voice: "bm_george", language: "en-GB" });
  parts.close();
});
