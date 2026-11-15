/**
 * The assistant's speech and the voice of each language, together (voice/lib/saying.ts,
 * voice/lib/speak-params.ts; docs/voice.md, "What the shell does"): every sentence of an answer is
 * its own queued `speak`, counted and logged, and each goes with the voices that may speak and the
 * language of the sentence before it, so the service says each in a voice of its own language.
 * And the answer is asked for in the language the person spoke (agents/assistant/).
 */

import { expect, test } from "bun:test";
import { contextBlock, type Moment, spokeWords } from "../src/agents/assistant/context.ts";
import { ASSISTANT_PROMPT, SMALL_ASSISTANT_PROMPT } from "../src/agents/assistant/prompt.ts";
import { TALK, talkKey } from "../src/voice/keys.ts";
import { sentencesOf } from "../src/voice/lib/sentences.ts";
import type { Answer, AskHears, SpeakExtras } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

/** Two English sentences and two Spanish, in turn. */
const MIXED = "I found it. Está en la carpeta de descargas. Do you want me to open it? Dime si quieres.";
/** What the service would tell of each: the test's stand-in for its detector. */
const TOLD: Readonly<Record<string, string>> = {
  "I found it.": "en",
  "Está en la carpeta de descargas.": "es",
  "Do you want me to open it?": "en",
  "Dime si quieres.": "es",
  "Abriendo YouTube en Helium.": "es",
};

function talking(answer: Answer, speak: SpeakExtras, heard: { text: string; language?: string } = { text: "abre Helium y ve a YouTube", language: "es" }) {
  const sent: Array<Record<string, unknown>> = [];
  const voice = fakeVoice({
    "listen.stop": { ...heard, speech_ms: 900 },
    // As the service: the language it tells, else the hint's ("OK." tells nothing).
    speak: (params: Record<string, unknown>) => {
      sent.push(params);
      const language = TOLD[String(params.text)] ?? (params.by_language === false ? "en" : params.hint);
      return { id: sent.length, language };
    },
  });
  const log: string[] = [];
  const state = { now: 1000 };
  const asked: Array<{ words: string; language: string | undefined }> = [];
  const talk = new Voice({
    service: voice.service,
    prefs: () => ({ on: true, key: talkKey(undefined), voice: "af_heart", speak }),
    trouble: () => null,
    hold: () => {},
    asker: {
      ask: (words: string, _signal: AbortSignal, hears?: AskHears) => {
        asked.push({ words, language: hears?.language });
        return Promise.resolve(answer);
      },
    },
    timers: handTimers(),
    now: () => state.now,
    log: (line) => log.push(line),
  });
  const hold = async (): Promise<void> => {
    talk.key(TALK, true);
    await settle();
    state.now += 1500;
    talk.key(TALK, false);
    await settle();
  };
  return { voice, sent, log, talk, hold, asked };
}

const VOICES = { voices: { "es-419": "ef_dora" }, hint: "en" };

test("an answer of four sentences, two English and two Spanish, is four speak calls in order, each with its language, none cut", async () => {
  // The person spoke Spanish: the conversation's language, for the first sentence.
  const { voice, sent, log, hold, asked } = talking({ say: MIXED }, { ...VOICES, hint: "es" });
  await hold();
  expect(asked).toEqual([{ words: "abre Helium y ve a YouTube", language: "es" }]);
  const each = { queue: true, voice: "af_heart", voices: { "es-419": "ef_dora" } };
  expect(sent).toEqual([
    { text: "I found it.", ...each, hint: "es" },
    // Each later sentence is told the language the one before was said in, as the service answered.
    { text: "Está en la carpeta de descargas.", ...each, hint: "en" },
    { text: "Do you want me to open it?", ...each, hint: "es" },
    { text: "Dime si quieres.", ...each, hint: "en" },
  ]);
  expect(sent.map((call) => TOLD[String(call.text)])).toEqual(["en", "es", "en", "es"]);
  for (const id of [1, 2, 3, 4]) voice.emit({ event: "spoken", id, reason: "done" });
  expect(log).toEqual(['said asked="abre Helium y ve a YouTube" handed=4 played=4 ended=done']);
});

test("a sentence whose words tell nothing keeps the language of the one before it, across speak calls", async () => {
  const { sent, hold } = talking({ say: "Abriendo YouTube en Helium. OK. Listo." }, VOICES);
  await hold();
  // "OK." after a Spanish sentence goes with Spanish as its hint, and so does what follows it.
  expect(sent.map((call) => [call.text, call.hint])).toEqual([
    ["Abriendo YouTube en Helium.", "en"],
    ["OK.", "es"],
    ["Listo.", "es"],
  ]);
});

test("with the switch off every sentence still has its own speak, in the one voice", async () => {
  const { voice, sent, log, hold } = talking({ say: MIXED }, { byLanguage: false });
  await hold();
  expect(sent).toEqual(sentencesOf(MIXED).map((text) => ({ text, queue: true, voice: "af_heart", by_language: false })));
  for (const id of [1, 2, 3, 4]) voice.emit({ event: "spoken", id, reason: "done" });
  expect(log[0]).toContain("handed=4 played=4 ended=done");
});

test("what a dictation paused is said after in the same voices: the first sentence kept goes after the language it had", async () => {
  const { voice, sent, log, talk, hold } = talking({ say: MIXED }, VOICES);
  await hold();
  voice.emit({ event: "spoken", id: 1, reason: "done" });
  talk.pauseSpeech();
  await settle();
  voice.emit({ event: "spoken", id: 2, reason: "stopped" });
  const before = sent.length;
  talk.resumeSpeech();
  await settle();
  expect(sent.slice(before).map((call) => [call.text, call.hint, call.queue])).toEqual([
    ["Está en la carpeta de descargas.", "en", true],
    ["Do you want me to open it?", "es", true],
    ["Dime si quieres.", "en", true],
  ]);
  for (const id of [5, 6, 7]) voice.emit({ event: "spoken", id, reason: "done" });
  expect(log.map((line) => line.replace(/^said asked="[^"]*" /, ""))).toEqual(["handed=4 played=1 ended=paused", "handed=3 played=3 ended=done"]);
});

test("an agent's question is said the same way, and a listen that ended by itself carries its language to the ask", async () => {
  const { voice, sent, talk, asked } = talking({ say: "" }, VOICES);
  talk.ask("¿Cuál quieres abrir?", () => {});
  await settle();
  expect(sent[0]).toEqual({ text: "¿Cuál quieres abrir?", queue: true, voice: "af_heart", voices: { "es-419": "ef_dora" }, hint: "en" });
  expect(asked).toEqual([]);
  voice.emit({ event: "spoken", id: 1, reason: "done" });
});

const MOMENT: Moment = {
  window: null,
  selection: null,
  time: new Date(2026, 10, 15, 21, 49),
  language: "en_US",
  desktop: null,
  apps: [],
  names: [],
  talk: "Answer in one or two short plain sentences.",
  about: "",
};

test("the model is told to answer in the language the person spoke, and to keep names as they are", () => {
  expect(ASSISTANT_PROMPT).toContain("Answer in the language they spoke");
  expect(ASSISTANT_PROMPT).toContain("Keep the names of products, apps and sites as they are written");
  expect(SMALL_ASSISTANT_PROMPT).toContain("Answer in the language they spoke");
  expect(spokeWords("es")).toBe("They spoke Spanish: answer in Spanish. Keep the names of products, apps and sites as they are written.");
  expect(spokeWords("es-CO")).toContain("Spanish");
  // Words that told no language, or one Dashi has no voice for: the prompt's rule alone.
  expect(spokeWords(undefined)).toBeNull();
  expect(spokeWords("ja")).toBeNull();
  const lines = contextBlock(MOMENT, { fresh: false, spoke: "es" }).split("\n");
  // With every ask, a resumed one too, just before how much to say.
  expect(lines.at(-2)).toBe("They spoke Spanish: answer in Spanish. Keep the names of products, apps and sites as they are written.");
  expect(contextBlock(MOMENT, { fresh: true })).not.toContain("They spoke");
});
