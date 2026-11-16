/**
 * The voice loop in a conversation (voice/voice.ts; decisions.md D147,
 * D150): an answer is spoken as it is written, a sentence at a time; each
 * thing Dashi does is the chip's line; while the conversation is open the
 * chip says so; and once Dashi's last sentence has played, and 300 ms more,
 * the microphone opens by itself for the reply, given up after 6 s of
 * nothing. Always after a question; never while a sample still plays.
 */

import { expect, test } from "bun:test";
import { TALK, talkKey } from "../src/voice/keys.ts";
import type { Answer, AskHears, Talk } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

function conversing(options: { listenAgain?: boolean; answer?: (words: string, hears: AskHears) => Promise<Answer> } = {}) {
  let id = 0;
  const voice = fakeVoice({ "listen.stop": { text: "open Helium and go to YouTube", speech_ms: 900 }, speak: () => ({ id: ++id }) });
  const timers = handTimers();
  const state = { now: 1000, open: false, rested: 0, ended: [] as string[] };
  const listeners = new Set<() => void>();
  const talk: Talk = {
    open: () => state.open,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rested: () => state.rested++,
    busy: () => {},
    end: (why) => {
      state.ended.push(why);
      state.open = false;
      for (const listener of listeners) listener();
    },
  };
  const asked: string[] = [];
  const talkTo = new Voice({
    service: voice.service,
    prefs: () => ({ on: true, key: talkKey(undefined), voice: undefined, listenAgain: options.listenAgain ?? true }),
    trouble: () => null,
    hold: () => {},
    asker: {
      talk,
      ask: async (words, _signal, hears) => {
        asked.push(words);
        state.open = true;
        return options.answer && hears ? options.answer(words, hears) : { say: "YouTube is open." };
      },
    },
    timers,
    now: () => state.now,
  });
  const hold = async (): Promise<void> => {
    talkTo.key(TALK, true);
    await settle();
    state.now += 1500;
    talkTo.key(TALK, false);
    await settle();
  };
  const listens = (): number => voice.calls.filter((call) => call === "listen").length;
  return { voice, timers, state, asked, talk: talkTo, hold, listens, chip: () => talkTo.getSnapshot() };
}

test("the answer is spoken as it comes: the first sentence goes to speak while the rest is still being written, and steps are the chip's line", async () => {
  let go = (): void => {};
  const gate = new Promise<void>((resolve) => {
    go = resolve;
  });
  const { voice, chip, hold } = conversing({
    answer: async (_words, hears) => {
      hears.say("Opening YouTube in Helium. Then I");
      hears.step("Opening youtube.com");
      await gate;
      hears.say("'ll read the page. ");
      hears.step("Reading the page");
      hears.say("YouTube is open.");
      return { say: "" };
    },
  });
  await hold();
  const spoke = (): string[] => voice.calls.filter((call) => call.startsWith("speak:"));
  // Only the whole sentence was handed over; the half-written one waits for its end.
  expect(spoke()).toEqual(["speak:Opening YouTube in Helium."]);
  expect(chip()).toEqual({ kind: "working", text: "Opening youtube.com" });
  go();
  await settle();
  expect(spoke()).toEqual(["speak:Opening YouTube in Helium.", "speak:Then I'll read the page.", "speak:YouTube is open."]);
});

test("after Dashi's last sentence, and 300 ms more, the microphone opens by itself; what is heard continues the conversation", async () => {
  const { voice, timers, asked, state, hold, listens, chip } = conversing();
  await hold();
  expect(listens()).toBe(1);
  voice.emit({ event: "spoken", id: 1, reason: "done" });
  // Not yet: the sample's tail, and the room.
  expect(chip()).toEqual({ kind: "open" });
  timers.advance(299);
  await settle();
  expect(listens()).toBe(1);
  timers.advance(1);
  await settle();
  expect(listens()).toBe(2);
  expect(voice.calls.at(-1)).toBe("listen.quiet");
  expect(chip()).toEqual({ kind: "listening", text: "", question: false });
  voice.emit({ event: "heard", text: "search for lo-fi" });
  await settle();
  expect(asked).toEqual(["open Helium and go to YouTube", "search for lo-fi"]);
  expect(state.rested).toBeGreaterThan(0);
});

test("nothing said for 6 s: the microphone closes without a complaint, and the conversation rests", async () => {
  const { voice, timers, hold, chip } = conversing();
  await hold();
  voice.emit({ event: "spoken", id: 1, reason: "done" });
  timers.advance(300);
  await settle();
  timers.advance(5999);
  expect(chip()?.kind).toBe("listening");
  timers.advance(1);
  await settle();
  expect(voice.calls.at(-1)).toBe("listen.cancel");
  expect(chip()).toEqual({ kind: "open" });
});

test("it never opens while a sentence is still to play, when the answer was stopped, or with the setting off", async () => {
  const two = conversing({ answer: async () => ({ say: "One. Two." }) });
  await two.hold();
  two.voice.emit({ event: "spoken", id: 1, reason: "done" });
  two.timers.advance(5000);
  await settle();
  expect(two.listens()).toBe(1);
  two.talk.stop();
  two.timers.advance(5000);
  await settle();
  expect(two.listens()).toBe(1);
  const off = conversing({ listenAgain: false });
  await off.hold();
  off.voice.emit({ event: "spoken", id: 1, reason: "done" });
  off.timers.advance(5000);
  await settle();
  expect(off.listens()).toBe(1);
  expect(off.chip()).toEqual({ kind: "open" });
});

test("after a question the microphone always opens, the setting off or not, and the answer does not stop the ask that asked", async () => {
  let answer = (_text: string): void => {};
  const answered = new Promise<string>((resolve) => {
    answer = resolve;
  });
  let question: (heard: (text: string) => void) => void = () => {};
  const h = conversing({
    listenAgain: false,
    answer: async (_words, hears) => {
      hears.say("Let me check.");
      question((text) => answer(text));
      const which = await answered;
      hears.say(`The ${which} one, then.`);
      return { say: "" };
    },
  });
  question = (heard) => h.talk.ask("Which calendar?", heard);
  await h.hold();
  expect(h.voice.calls.filter((call) => call.startsWith("speak:"))).toEqual(["speak:Let me check.", "speak:Which calendar?"]);
  h.voice.emit({ event: "spoken", id: 1, reason: "done" });
  h.voice.emit({ event: "spoken", id: 2, reason: "done" });
  h.timers.advance(300);
  await settle();
  expect(h.listens()).toBe(2);
  expect(h.chip()).toEqual({ kind: "listening", text: "", question: true });
  h.voice.emit({ event: "heard", text: "work" });
  await settle();
  expect(h.asked).toHaveLength(1);
  expect(h.voice.calls.at(-1)).toBe("speak:The work one, then.");
});

test("after a card gave up, a bare yes or no said a moment too late is not a new ask; other words, and later ones, are", async () => {
  const h = conversing();
  const answers = (text: string): boolean => /^(?:yes|no)\b/i.test(text);
  h.talk.over(10_000, answers);
  h.voice.replies["listen.stop"] = { text: "Yes, go ahead.", speech_ms: 600 };
  await h.hold();
  expect(h.asked).toEqual([]);
  expect(h.chip()).toEqual({ kind: "notice", text: "That question is over. Nothing was done." });
  // Once only: the next words are an ask again.
  await h.hold();
  expect(h.asked).toEqual(["Yes, go ahead."]);
  h.talk.over(10_000, answers);
  h.state.now += 20_000;
  await h.hold();
  expect(h.asked).toHaveLength(2);
});

test("❖Esc ends the conversation; the capsule's square only stops what is said", async () => {
  const { voice, state, talk, hold, chip } = conversing();
  await hold();
  talk.stop();
  expect(state.ended).toEqual([]);
  expect(chip()).toEqual({ kind: "open" });
  talk.key("stop", true);
  await settle();
  expect(state.ended).toEqual(["stopped"]);
  expect(chip()).toBeNull();
  expect(voice.calls).toContain("speak.stop");
});

test("the key held while a listen that opened by itself has heard nothing takes its place, even while the service still closes that one", async () => {
  const { voice, timers, asked, talk, state, hold } = conversing();
  await hold();
  voice.emit({ event: "spoken", id: 1, reason: "done" });
  timers.advance(300);
  await settle();
  // The service answers the cancel before it has let go of the microphone: the first listen after it is refused.
  let refusals = 2;
  voice.replies.listen = () => {
    if (refusals-- > 0) throw new Error("Voice is already listening.");
    return {};
  };
  voice.replies["listen.stop"] = { text: "search for lo-fi", speech_ms: 800 };
  talk.key(TALK, true);
  await settle();
  timers.advance(100);
  await settle();
  timers.advance(100);
  await settle();
  expect(talk.getSnapshot()).toEqual({ kind: "listening", text: "", question: false });
  state.now += 1500;
  talk.key(TALK, false);
  await settle();
  expect(asked).toEqual(["open Helium and go to YouTube", "search for lo-fi"]);
});

test("once the detector hears the person begin, the 6 s give-up never cuts them off; the quiet after them ends the turn (D199)", async () => {
  const { voice, timers, hold, chip } = conversing();
  await hold();
  voice.emit({ event: "spoken", id: 1, reason: "done" });
  timers.advance(300);
  await settle();
  // They begin at 5.9 s: no words yet (partials lag), but the detector heard them.
  timers.advance(5900);
  voice.emit({ event: "speech" });
  timers.advance(5000);
  await settle();
  expect(voice.calls).not.toContain("listen.cancel");
  expect(chip()?.kind).toBe("listening");
  expect(voice.calls).toContain("listen.quiet");
});
