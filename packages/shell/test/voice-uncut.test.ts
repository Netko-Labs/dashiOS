/**
 * Dashi's speech is never cut (voice/lib/saying.ts, agents/ask/plan.ts
 * `wholeWords`): every sentence of an answer is handed to `speak`, whatever
 * its length and however many paragraphs; a card answered by a press lets
 * the sentence finish; a dictation that starts while Dashi speaks pauses it
 * and the rest is said after; and each utterance leaves one line in the log.
 */

import { expect, test } from "bun:test";
import { spokenWords, wholeWords } from "../src/agents/ask/plan.ts";
import { TALK, talkKey } from "../src/voice/keys.ts";
import { answerOf } from "../src/voice/lib/answer.ts";
import { SentenceCutter, sentencesOf } from "../src/voice/lib/sentences.ts";
import type { Answer } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

/** One of the answers that was cut on 15 Nov: 301 characters, said as its first 139. */
const LONG =
  "I can open apps like Helium, move and arrange windows, make notes, open files, and change settings like sound, Wi-Fi, Dark Mode and screen brightness. " +
  "I can also read the page in front and click in it. If you want something I can't do, I'll say so. Ask me for one thing at a time, or several.";

function talking(answer: Answer) {
  let id = 6;
  const voice = fakeVoice({ "listen.stop": { text: "What can you do?", speech_ms: 900 }, speak: () => ({ id: ++id }) });
  const timers = handTimers();
  const log: string[] = [];
  const state = { now: 1000 };
  const talk = new Voice({
    service: voice.service,
    prefs: () => ({ on: true, key: talkKey(undefined), voice: undefined }),
    trouble: () => null,
    hold: () => {},
    asker: { ask: () => Promise.resolve(answer) },
    timers,
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
  const spoke = (): string[] => voice.calls.filter((call) => call.startsWith("speak:")).map((call) => call.slice(6));
  return { voice, timers, log, talk, hold, spoke };
}

test("a long answer is spoken whole: every sentence, far past 140 characters", async () => {
  expect(LONG.length).toBeGreaterThan(280);
  const { voice, log, hold, spoke } = talking({ say: LONG });
  await hold();
  expect(spoke().join(" ")).toBe(LONG);
  expect(spoke()).toHaveLength(4);
  for (const id of [7, 8, 9, 10]) voice.emit({ event: "spoken", id, reason: "done" });
  expect(log).toEqual(['said asked="What can you do?" handed=4 played=4 ended=done']);
});

test("what a task keeps for speech is all the model said, both paragraphs; the launcher's row keeps its one short line", () => {
  const text = `I can't open that site from here.\n\n${LONG}`;
  expect(spokenWords(text).length).toBeLessThanOrEqual(140);
  expect(wholeWords(text)).toBe(text);
  // Its tools' chatter is never said.
  expect(wholeWords("29 tools | ok: Planned as step 1\n\nDone.")).toBe("Done.");
  const said = answerOf({ phase: "done", steps: [], said: spokenWords(text), words: wholeWords(text), failure: null });
  expect(said?.say).toContain("several.");
  expect(sentencesOf(said?.say ?? "")).toHaveLength(5);
});

test("sentences are cut as the words come, and what is left at the end is said too", () => {
  const cutter = new SentenceCutter();
  expect(cutter.push("Opening YouTube")).toEqual([]);
  expect(cutter.push(" in Helium. It is 3.5 times")).toEqual(["Opening YouTube in Helium."]);
  expect(cutter.push(" faster, e.g. on Wi-Fi.\n\n**Done**")).toEqual(["It is 3.5 times faster, e.g. on Wi-Fi."]);
  expect(cutter.end()).toEqual(["Done"]);
  expect(sentencesOf("- One thing\n- [A link](https://example.com) here")).toEqual(["One thing A link here"]);
});

test("stopped half way, the log says how many sentences played", async () => {
  const { voice, log, talk, hold } = talking({ say: LONG });
  await hold();
  voice.emit({ event: "spoken", id: 7, reason: "done" });
  talk.stop();
  expect(log).toEqual(['said asked="What can you do?" handed=4 played=1 ended=stopped']);
});

test("a dictation that starts while Dashi speaks pauses it: the rest is said after, from the sentence it stopped in", async () => {
  const { voice, log, talk, hold, spoke } = talking({ say: LONG });
  await hold();
  voice.emit({ event: "spoken", id: 7, reason: "done" });
  talk.pauseSpeech();
  await settle();
  expect(talk.getSnapshot()).toEqual({ kind: "notice", text: "Paused while you dictate." });
  expect(voice.calls.at(-1)).toBe("speak.stop");
  // The service ends what it was playing; that is not the end of the answer.
  voice.emit({ event: "spoken", id: 8, reason: "stopped" });
  const before = spoke().length;
  talk.resumeSpeech();
  await settle();
  expect(spoke().slice(before)).toEqual(sentencesOf(LONG).slice(1));
  for (const id of [11, 12, 13]) voice.emit({ event: "spoken", id, reason: "done" });
  expect(log).toEqual(['said asked="What can you do?" handed=4 played=1 ended=paused', 'said asked="What can you do?" handed=3 played=3 ended=done']);
  expect(talk.getSnapshot()).toBeNull();
});

test("a card answered by a press lets Dashi finish what it was saying; one given up on stops it", async () => {
  const { voice, talk } = talking({ say: "" });
  const kept = talk.ask("I can't go to a web page for you. I would open Helium. Say yes, or press Yes.", () => {});
  await settle();
  kept(true);
  await settle();
  expect(voice.calls).not.toContain("speak.stop");
  const dropped = talk.ask("Which calendar?", () => {});
  await settle();
  dropped();
  await settle();
  expect(voice.calls).toContain("speak.stop");
});
