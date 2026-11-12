/**
 * Talking to Dashi (voice/voice.ts; docs/voice.md, "What the shell does"):
 * the key held is a listen, let go it is the words, which the agent answers
 * and Dashi says with captions in step; a tap, Esc and the key again; what
 * is missing said in words; and an agent's question answered by voice.
 */

import { expect, test } from "bun:test";
import { STOP, TALK, talkKey } from "../src/voice/keys.ts";
import type { Answer, Chip } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

function talking(options: { on?: boolean; trouble?: string | null; answer?: Answer | ((words: string) => Promise<Answer>) } = {}) {
  const voice = fakeVoice({ "listen.stop": { text: "Open the calendar.", speech_ms: 900 }, speak: { id: 7 } });
  const timers = handTimers();
  const held: string[][] = [];
  const asked: string[] = [];
  const state = { on: options.on ?? true, trouble: options.trouble ?? null, now: 1000, key: talkKey(undefined), stopped: 0 };
  const talk = new Voice({
    service: voice.service,
    prefs: () => ({ on: state.on, key: state.key, voice: undefined }),
    trouble: () => (state.trouble ? { text: state.trouble, go: "voice" } : null),
    hold: (keys) => held.push(keys.map((key) => `${key.name}:${key.code}${key.bare ? ":bare" : ""}`)),
    asker: {
      ask: (words, signal) => {
        asked.push(words);
        signal.addEventListener("abort", () => state.stopped++);
        const { answer } = options;
        return typeof answer === "function" ? answer(words) : Promise.resolve(answer ?? { say: "Here it is. Your next meeting is at four." });
      },
    },
    timers,
    now: () => state.now,
  });
  const chip = (): Chip | null => talk.getSnapshot();
  /** Hold the key for `ms`, then let go. */
  const hold = async (ms: number): Promise<void> => {
    talk.key(TALK, true);
    await settle();
    state.now += ms;
    talk.key(TALK, false);
    await settle();
  };
  return { voice, timers, held, asked, state, talk, chip, hold };
}

const SENTENCE = {
  event: "sentence" as const,
  id: 7,
  index: 0,
  text: "Here it is.",
  ms: 900,
  words: [
    { text: "Here", start: 100, end: 300 },
    { text: "it", start: 320, end: 420 },
    { text: "is.", start: 440, end: 800 },
  ],
};

test("Voice off holds no key; on, the talk key by its codes, and Esc only while there is something to stop", async () => {
  const off = talking({ on: false });
  expect(off.held).toEqual([[]]);
  const { held, talk, state } = talking();
  expect(held).toEqual([["talk:126", "talk:193"]]);
  talk.key(TALK, true);
  await settle();
  expect(held.at(-1)).toEqual(["talk:126", "talk:193", "stop:1:bare"]);
  talk.key(STOP, true);
  await settle();
  expect(held.at(-1)).toEqual(["talk:126", "talk:193"]);
  state.key = talkKey("right-option");
  talk.sync();
  expect(held.at(-1)).toEqual(["talk:100"]);
});

test("held, Dashi listens and shows the words as they are heard; let go, the agent is asked and answers out loud with captions in step", async () => {
  const { voice, timers, asked, talk, chip, state } = talking();
  talk.key(TALK, true);
  await settle();
  expect(voice.calls).toEqual(["listen"]);
  expect(chip()).toEqual({ kind: "listening", text: "", question: false });
  voice.emit({ event: "level", level: 0.4 });
  expect(talk.level.getSnapshot()).toBe(0.4);
  voice.emit({ event: "partial", text: "Open the" });
  expect(chip()).toEqual({ kind: "listening", text: "Open the", question: false });
  state.now += 2000;
  talk.key(TALK, false);
  await settle();
  expect(voice.calls).toEqual(["listen", "listen.stop", "speak:Here it is. Your next meeting is at four."]);
  expect(asked).toEqual(["Open the calendar."]);
  expect(chip()).toEqual({ kind: "thinking", text: "Open the calendar." });
  voice.emit(SENTENCE);
  expect(chip()).toEqual({ kind: "speaking", words: ["Here", "it", "is."], said: 0, full: "Here it is." });
  timers.advance(100);
  expect(chip()).toMatchObject({ kind: "speaking", said: 1 });
  timers.advance(350);
  expect(chip()).toMatchObject({ kind: "speaking", said: 3 });
  voice.emit({ event: "spoken", id: 7, reason: "done" });
  expect(chip()).toBeNull();
});

test("a tap listens to nothing and says how to talk; silence is not turned into an ask", async () => {
  const { voice, asked, chip, hold, timers } = talking();
  await hold(120);
  expect(voice.calls).toEqual(["listen", "listen.cancel"]);
  expect(chip()).toEqual({ kind: "notice", text: "Hold the right ❖ key, or the Copilot key to talk." });
  timers.advance(2500);
  expect(chip()).toBeNull();
  voice.replies["listen.stop"] = { text: "", speech_ms: 0 };
  await hold(1500);
  expect(asked).toEqual([]);
  expect(chip()).toEqual({ kind: "notice", text: "I didn't hear anything." });
});

test("Esc, the key again, and a press on the chip each stop Dashi at once", async () => {
  const { voice, talk, chip, hold } = talking();
  await hold(1500);
  voice.emit(SENTENCE);
  talk.key(STOP, true);
  await settle();
  expect(voice.calls.at(-1)).toBe("speak.stop");
  expect(chip()).toBeNull();
  // A sentence of the stopped utterance that was on its way shows nothing.
  voice.emit({ ...SENTENCE, index: 1 });
  expect(chip()).toBeNull();

  await hold(1500);
  voice.emit(SENTENCE);
  const before = voice.calls.length;
  // The key again: stopped at once, and a tap after it says nothing more.
  await hold(100);
  expect(voice.calls.slice(before)).toEqual(["speak.stop", "listen", "listen.cancel"]);
  expect(chip()).toBeNull();
});

test("Esc while the agent thinks gives the ask up, and its late answer is not said", async () => {
  let answer: (answer: Answer) => void = () => {};
  const { voice, talk, chip, hold, state } = talking({ answer: () => new Promise((resolve) => (answer = resolve)) });
  await hold(1500);
  expect(chip()?.kind).toBe("thinking");
  talk.stop();
  expect(state.stopped).toBe(1);
  answer({ say: "Too late." });
  await settle();
  expect(voice.calls.some((call) => call.startsWith("speak:"))).toBe(false);
  expect(chip()).toBeNull();
});

test("what is missing is said where the person looks, and nothing listens", async () => {
  const { voice, chip, hold } = talking({ trouble: "Voice needs its models. Fetch them in Settings › Voice." });
  await hold(1500);
  expect(voice.calls).toEqual([]);
  expect(chip()).toEqual({ kind: "notice", text: "Voice needs its models. Fetch them in Settings › Voice.", go: "voice" });
});

test("no microphone: the service's own words show, and go to Settings › Voice", async () => {
  const { voice, chip, hold } = talking();
  voice.replies.listen = new Error("Voice can't hear: no microphone was found.");
  await hold(1500);
  expect(chip()).toEqual({ kind: "notice", text: "Voice can't hear: no microphone was found.", go: "voice" });
  expect(voice.calls).toEqual(["listen"]);
});

test("an ask that failed is said, and its words stay in the chip with where to go", async () => {
  const { voice, chip, hold, timers } = talking({ answer: { say: "No agent answers yet. Choose one in Settings, under Agents.", failed: { go: "agents" } } });
  await hold(1500);
  const notice: Chip = { kind: "notice", text: "No agent answers yet. Choose one in Settings, under Agents.", go: "agents" };
  expect(chip()).toEqual(notice);
  voice.emit({ ...SENTENCE, text: "No agent answers yet." });
  expect(chip()).toEqual(notice);
  voice.emit({ event: "spoken", id: 7, reason: "done" });
  expect(chip()).toEqual(notice);
  timers.advance(4000);
  expect(chip()).toBeNull();
});

test("an answer that can't be said is shown instead", async () => {
  const { voice, chip, hold } = talking({ answer: { say: "こんにちは" } });
  voice.replies.speak = new Error("Voice can't speak ja.");
  await hold(1500);
  expect(chip()).toEqual({ kind: "notice", text: "こんにちは" });
});

test("an agent's question is said, and the next words heard are its answer, not an ask", async () => {
  const { voice, asked, talk, chip, hold } = talking();
  const heard: string[] = [];
  const end = talk.ask("Claude asks: Which calendar?", (text) => heard.push(text));
  await settle();
  expect(voice.calls).toEqual(["speak:Claude asks: Which calendar?"]);
  expect(talk.talkKey()).toBe("the right ❖ key, or the Copilot key");
  talk.key(TALK, true);
  await settle();
  expect(chip()).toEqual({ kind: "listening", text: "", question: true });
  voice.replies["listen.stop"] = { text: "The work one.", speech_ms: 700 };
  await hold(0);
  talk.key(TALK, false);
  await settle();
  expect(heard).toEqual([]);
  await hold(1200);
  expect(heard).toEqual(["The work one."]);
  expect(asked).toEqual([]);
  expect(chip()).toEqual({ kind: "notice", text: "You said: The work one." });
  end();
  // Answered: the next thing said is an ask again.
  await hold(1200);
  expect(asked).toEqual(["The work one."]);
});

test("a question with Voice off is not said, and names no key", async () => {
  const { voice, talk } = talking({ on: false });
  const end = talk.ask("Claude asks: Which calendar?", () => {});
  await settle();
  expect(voice.calls).toEqual([]);
  expect(talk.talkKey()).toBeNull();
  end();
});
