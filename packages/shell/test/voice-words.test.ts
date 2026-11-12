/**
 * Voice's pure pieces: how long words are cut for the chip's one line
 * (voice/lib/captions.ts), which keys are held (voice/keys.ts), where the
 * chip sits (voice/chip.tsx), a task said out loud (voice/lib/answer.ts),
 * and starting the service from a checkout (voice/lib/launch.ts).
 */

import { expect, test } from "bun:test";
import { launcherAsker, type SpokenTasks } from "../src/voice/asker.ts";
import { barHeights, chipChars, chipLabel, chipPlace, VOICE_CHIP } from "../src/voice/chip.tsx";
import { heldKeys, isTalkKeyId, isVoiceId, TALK_KEYS, talkKey } from "../src/voice/keys.ts";
import { answerOf, planWords, SPOKEN_CONTEXT, type SpokenTask } from "../src/voice/lib/answer.ts";
import { CAPTION_CHARS, captionLines, head, lineAt, listenLanguage, tail } from "../src/voice/lib/captions.ts";
import { serviceCommand, voiceConnector } from "../src/voice/lib/launch.ts";
import { sizeWords } from "../src/voice/models.ts";
import { settle } from "./support/time.ts";
import { fakeVoice } from "./support/voice.ts";

test("a sentence is cut into lines at word ends, and the line that holds the word being said shows", () => {
  const words = "It is ten past four. You have two meetings left today, and the first one starts in twenty minutes.".split(" ");
  const lines = captionLines(words);
  expect(lines.every((line) => line.words.join(" ").length <= CAPTION_CHARS)).toBe(true);
  expect(lines.flatMap((line) => line.words)).toEqual(words);
  expect(lines.length).toBe(2);
  // A narrower chip holds fewer characters, so more lines: never a wider row.
  expect(captionLines(words, 30).length).toBeGreaterThan(2);
  expect(captionLines(words, 30).every((line) => line.words.join(" ").length <= 30)).toBe(true);
  expect(lineAt(lines, -1)).toEqual({ line: lines[0], said: 0 } as ReturnType<typeof lineAt>);
  expect(lineAt(lines, 0)?.said).toBe(1);
  const second = lines[1]?.first ?? 0;
  expect(lineAt(lines, second)).toEqual({ line: lines[1], said: 1 } as ReturnType<typeof lineAt>);
  expect(lineAt(lines, words.length - 1)?.said).toBe(lines[1]?.words.length ?? 0);
  // A word longer than a line is a line by itself, never dropped.
  expect(captionLines(["a", "x".repeat(80), "b"]).map((line) => line.words.length)).toEqual([1, 1, 1]);
  expect(lineAt([], 0)).toBeNull();
});

test("what the person says shows its newest words; a notice its first", () => {
  expect(tail("Open the calendar")).toBe("Open the calendar");
  const long = "What's the weather like in Bogota tomorrow morning? And remind me to call Alex at noon.";
  const end = tail(long, 40);
  expect(end.startsWith("…")).toBe(true);
  expect([...end].length).toBeLessThanOrEqual(40);
  expect(long.endsWith(end.slice(1))).toBe(true);
  // Cut at a word's start, never mid-word.
  expect(long[long.length - end.length] === " " || long.length === end.length - 1).toBe(true);
  const start = head(long, 40);
  expect(start.endsWith("…")).toBe(true);
  expect(long.startsWith(start.slice(0, -1))).toBe(true);
  expect(tail("x".repeat(100), 10)).toBe(`…${"x".repeat(9)}`);
});

test("a listen names a language only when Parakeet lacks it", () => {
  expect(listenLanguage("en_US.UTF-8")).toBeUndefined();
  expect(listenLanguage("es_CO.UTF-8")).toBeUndefined();
  expect(listenLanguage("ja_JP.UTF-8")).toBe("ja");
  expect(listenLanguage("C")).toBeUndefined();
  expect(listenLanguage(undefined)).toBeUndefined();
});

test("the talk key: the right ❖ and the Copilot key unless another is picked, and Esc bare while there is something to stop", () => {
  expect(heldKeys(talkKey(undefined), false)).toEqual([
    { name: "talk", code: 126 },
    { name: "talk", code: 193 },
  ]);
  expect(heldKeys(talkKey("caps-lock"), true)).toEqual([
    { name: "talk", code: 58 },
    { name: "stop", code: 1, bare: true },
  ]);
  expect(heldKeys(null, false)).toEqual([]);
  // Every key says what it stops doing while it talks, and none is listed twice.
  expect(TALK_KEYS.every((key) => key.cost !== undefined && key.codes.length > 0)).toBe(true);
  expect(new Set(TALK_KEYS.flatMap((key) => key.codes)).size).toBe(TALK_KEYS.flatMap((key) => key.codes).length);
  expect(isTalkKeyId("menu")).toBe(true);
  expect(isTalkKeyId("space")).toBe(false);
  expect(talkKey(undefined).id).toBe("default");
  expect(isVoiceId("af_heart")).toBe(true);
  expect(isVoiceId("../etc")).toBe(false);
});

test("the chip sits in the room between the menus and the status side, and keeps 150 when there is less", () => {
  // A wide bar: centred in the room, at its widest.
  expect(chipPlace(1600, 300, 360)).toEqual({ left: 318 + (904 - 440) / 2, width: 440 });
  // Less room than its widest: all of the room.
  expect(chipPlace(1000, 300, 360)).toEqual({ left: 318, width: 304 });
  // Hardly any: 150, centred on the room, inside the bar.
  const tight = chipPlace(800, 380, 360);
  expect(tight.width).toBe(VOICE_CHIP.minWidth);
  expect(tight.left + tight.width / 2).toBe((398 + 422) / 2);
  expect(tight.left).toBeLessThan(398);
  expect(chipPlace(300, 200, 90).left).toBeGreaterThanOrEqual(6);
});

test("the meter's bars rise with the level, and the chip is named for a screen reader", () => {
  expect(barHeights(0)).toEqual([3, 3, 3, 3, 3]);
  expect(barHeights(1)).toEqual([8, 12, 14, 12, 8]);
  expect(barHeights(7)).toEqual(barHeights(1));
  expect(chipLabel({ kind: "speaking", words: ["Here"], at: 0, full: "Here it is." })).toBe("Dashi says: Here it is. Stop");
  // The line's length follows the chip's width: all 56 at its widest, fewer in less room, never under 12.
  expect(chipChars(VOICE_CHIP.maxWidth)).toBe(CAPTION_CHARS);
  expect(chipChars(313)).toBe(44);
  expect(chipChars(VOICE_CHIP.minWidth)).toBe(18);
  expect(chipChars(40)).toBe(12);
  expect(chipLabel({ kind: "listening", text: "", question: false })).toBe("Dashi is listening");
  expect(chipLabel({ kind: "notice", text: "Voice needs its models." })).toBe("Voice needs its models.");
});

const task = (over: Partial<SpokenTask>): SpokenTask => ({ phase: "done", steps: [], said: "", failure: null, ...over });

test("a task said out loud: its words, its plan and the Return it waits for, or why it didn't answer", () => {
  expect(answerOf(task({ phase: "asking" }))).toBeNull();
  expect(answerOf(task({ said: "It is ten past four" }))).toEqual({ say: "It is ten past four." });
  expect(answerOf(task({}))).toEqual({ say: "I have nothing to say to that." });
  expect(answerOf(task({ phase: "planned", steps: [{ title: "Turn Dark Mode on" }] }))).toEqual({
    say: "My plan: Turn Dark Mode on. Press Return in the launcher to run it.",
    plan: true,
  });
  expect(planWords("Sure", ["Turn Dark Mode on", "Hide the Dock"])).toBe(
    "Sure. My plan has 2 steps: Turn Dark Mode on; Hide the Dock. Press Return in the launcher to run it.",
  );
  expect(answerOf(task({ phase: "failed", failure: { kind: "not-signed-in", text: "Claude Code isn't signed in." } }))).toEqual({
    say: "Claude Code isn't signed in.",
    failed: { go: "launcher" },
  });
  expect(answerOf(task({ phase: "failed", failure: { kind: "no-answer", text: "Claude didn't answer." } }))).toEqual({
    say: "Claude didn't answer.",
    failed: {},
  });
  expect(answerOf(task({ phase: "stopped" }))).toEqual({ say: "" });
});

function tasks(first: SpokenTask | null): SpokenTasks & { asked: Array<[string, string | undefined]>; stopped: string[]; set(next: SpokenTask): void } {
  let now = first;
  const listeners = new Set<() => void>();
  return {
    asked: [],
    stopped: [],
    ask(request, context) {
      this.asked.push([request, context]);
      return now ? "ask-1" : null;
    },
    get: () => now ?? undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop(id) {
      this.stopped.push(id);
    },
    set(next) {
      now = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

test("a spoken ask is a launcher task: told it was spoken, answered when the task is, its plan shown for Return, stopped when given up", async () => {
  const store = tasks(task({ phase: "asking" }));
  let shown = 0;
  const asker = launcherAsker(
    () => store,
    () => shown++,
  );
  const answer = asker.ask("Turn on Dark Mode", new AbortController().signal);
  expect(store.asked).toEqual([["Turn on Dark Mode", SPOKEN_CONTEXT]]);
  store.set(task({ phase: "planned", steps: [{ title: "Turn Dark Mode on" }] }));
  expect(await answer).toEqual({ say: "My plan: Turn Dark Mode on. Press Return in the launcher to run it." });
  expect(shown).toBe(1);

  // Nobody answers the launcher: said so, with where to choose.
  const none = launcherAsker(
    () => tasks(null),
    () => {},
  );
  expect(await none.ask("Hello", new AbortController().signal)).toEqual({
    say: "No agent answers yet. Choose one in Settings, under Agents.",
    failed: { go: "agents" },
  });

  const waiting = tasks(task({ phase: "asking" }));
  const given = new AbortController();
  const late = launcherAsker(
    () => waiting,
    () => {},
  ).ask("Hello", given.signal);
  given.abort();
  expect(await late).toEqual({ say: "" });
  expect(waiting.stopped).toEqual(["ask-1"]);
});

test("from a checkout the service starts as a unit of its own, once, never as the shell's child", async () => {
  expect(serviceCommand({})).toBeNull();
  expect(serviceCommand({ DASHI_VOICE: "/w/target/release/dashi-voice", DASHI_VOICE_MODELS: "/models" })).toEqual([
    "systemd-run",
    "--user",
    "--collect",
    "--quiet",
    "--unit",
    "dashi-voice",
    "--setenv=DASHI_VOICE_MODELS=/models",
    "/w/target/release/dashi-voice",
    "serve",
  ]);
  const ran: string[][] = [];
  let up = false;
  const link = await fakeVoice().service.get();
  const connect = voiceConnector({
    env: { DASHI_VOICE: "/w/dashi-voice", XDG_RUNTIME_DIR: "/run/user/1000" },
    connect: async () => (up ? link : null),
    run: async (command) => {
      ran.push(command);
      up = true;
    },
    wait: async () => {},
  });
  expect(await connect()).toBe(link);
  expect(ran.length).toBe(1);
  // Gone again: it is not started a second time (the unit is the session's to restart).
  up = false;
  expect(await connect()).toBeNull();
  expect(ran.length).toBe(1);
  // An installed session has the socket: nothing is started.
  const installed = voiceConnector({ env: { XDG_RUNTIME_DIR: "/run/user/1000" }, connect: async () => null, run: async (command) => void ran.push(command) });
  expect(await installed()).toBeNull();
  expect(ran.length).toBe(1);
  await settle();
});

test("sizes read as the fetch says them", () => {
  expect(sizeWords(1_007_795_219)).toBe("1.01 GB");
  expect(sizeWords(672_862_728)).toBe("673 MB");
  expect(sizeWords(0)).toBe("1 MB");
});
