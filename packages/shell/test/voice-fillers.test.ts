/**
 * Fillers in the voice loop (voice/lib/fillers.ts, D197): "Um" tells no language and a short reply keeps the
 * conversation's; only languages turned on are ever chosen; "Um" or "Okay" alone, heard when Dashi listened by itself,
 * starts no turn; with the key held, what is said is always sent.
 */

import { expect, test } from "bun:test";
import { TALK, talkKey } from "../src/voice/keys.ts";
import { fillerOnly, KeptTongue } from "../src/voice/lib/fillers.ts";
import { tonguesOn } from "../src/voice/tongues.ts";
import type { SpokenVoice, Talk } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

test("a filler is only sounds, or a nod that answers nothing", () => {
  for (const said of ["Um.", "Uh uh.", "Um, uh.", "Hmm.", "Okay.", "OK", "Vale."]) expect(fillerOnly(said)).toBe(true);
  for (const said of ["Um, open Helium.", "No.", "Yes.", "Stop.", "", "Sí."]) expect(fillerOnly(said)).toBe(false);
  // After "Shall I open it?", "Okay" is the answer; "Um" still is not.
  expect(fillerOnly("Okay.", true)).toBe(false);
  expect(fillerOnly("Um.", true)).toBe(true);
});

test("the conversation's language is the last one told with confidence, among those turned on", () => {
  const tongue = new KeptTongue(() => ["en", "es"]);
  expect(tongue.tell("Abre el navegador en YouTube", "es")).toBe("es");
  expect(tongue.tell("Um.", "pt")).toBe("es");
  expect(tongue.tell("Uh uh.", "pt")).toBe("es");
  expect(tongue.tell("OK.", "en")).toBe("es");
  expect(tongue.tell("Open the settings please", "en")).toBe("en");
  // Portuguese is not on: even a long sentence told as it is keeps the last.
  expect(tongue.tell("Abra o navegador por favor agora", "pt")).toBe("en");
  // At the very start a short reply in a language that is on is taken as it is, and one that is not is not.
  expect(new KeptTongue(() => ["en", "es"]).tell("Hola.", "es")).toBe("es");
  expect(new KeptTongue(() => ["en", "es"]).tell("Um.", "pt")).toBeUndefined();
});

test("the languages turned on: English and Spanish by default, Portuguese only when given a voice", () => {
  const voices: SpokenVoice[] = [
    { id: "af_heart", name: "Heart", language: "en-US", language_name: "English", installed: true, pairs: { es: "ef_dora" } },
    { id: "ef_dora", name: "Dora", language: "es", language_name: "Spanish", installed: true },
    { id: "pf_dora", name: "Dora", language: "pt-BR", language_name: "Portuguese", installed: true },
  ];
  expect(tonguesOn({}, voices, "af_heart")).toEqual(["en", "es"]);
  expect(tonguesOn({ voices: { es: false } }, voices, "af_heart")).toEqual(["en"]);
  expect(tonguesOn({ voices: { pt: "pf_dora" } }, voices, "af_heart")).toEqual(["en", "es", "pt"]);
  expect(tonguesOn({}, [], "af_heart")).toEqual(["en", "es"]);
});

function looping(said: string, answer = "YouTube is open.") {
  let id = 0;
  const voice = fakeVoice({ "listen.stop": { text: said, speech_ms: 900, language: "pt" }, speak: () => ({ id: ++id }) });
  const timers = handTimers();
  const state = { now: 1000, open: false };
  const talk: Talk = { open: () => state.open, subscribe: () => () => {}, rested: () => {}, busy: () => {}, end: () => {} };
  const asked: Array<[string, string | undefined]> = [];
  const loop = new Voice({
    service: voice.service,
    prefs: () => ({ on: true, key: talkKey(undefined), voice: undefined, listenAgain: true }),
    trouble: () => null,
    hold: () => {},
    tongue: new KeptTongue(() => ["en", "es"]),
    asker: {
      talk,
      ask: async (words, _signal, hears) => {
        asked.push([words, hears?.language]);
        state.open = true;
        return { say: answer };
      },
    },
    timers,
    now: () => state.now,
  });
  const hold = async (): Promise<void> => {
    loop.key(TALK, true);
    await settle();
    state.now += 1500;
    loop.key(TALK, false);
    await settle();
  };
  /** Dashi's sentence played; the microphone opens by itself, and `words` are heard. */
  let played = 0;
  const reply = async (words: string, language?: string): Promise<void> => {
    while (played < id) voice.emit({ event: "spoken", id: ++played, reason: "done" });
    timers.advance(300);
    await settle();
    voice.emit({ event: "heard", text: words, ...(language ? { language } : {}) });
    await settle();
  };
  const says = (text: string, language: string): void => {
    voice.replies["listen.stop"] = { text, speech_ms: 900, language };
  };
  return { asked, hold, reply, says, listens: () => voice.calls.filter((call) => call === "listen").length, chip: () => loop.getSnapshot() };
}

test("with the key held, even “Um” is sent, and its told Portuguese is never the language", async () => {
  const { asked, hold } = looping("Um.");
  await hold();
  expect(asked).toEqual([["Um.", undefined]]);
});

test("“Um” or “Okay” heard after Dashi speaks starts no turn; a real reply does, in the language kept", async () => {
  const { asked, hold, reply, says, chip } = looping("Abre YouTube en el navegador, por favor.");
  await hold();
  expect(asked).toEqual([["Abre YouTube en el navegador, por favor.", undefined]]);
  await reply("Um.", "pt");
  expect(asked.length).toBe(1);
  expect(chip()?.kind).not.toBe("thinking");
  says("Busca música lo-fi en YouTube", "es");
  await hold();
  await reply("Okay.", "en");
  expect(asked.length).toBe(2);
  says("Uh, sí.", "pt");
  await hold();
  expect(asked.slice(1)).toEqual([
    ["Busca música lo-fi en YouTube", "es"],
    ["Uh, sí.", "es"],
  ]);
});

test("“Okay” after Dashi asked something is the answer, and goes", async () => {
  const { asked, hold, reply } = looping("Find the invoice from Alex please", "I found two. Shall I open the newest?");
  await hold();
  await reply("Okay.", "en");
  expect(asked.map(([words]) => words)).toEqual(["Find the invoice from Alex please", "Okay."]);
});
