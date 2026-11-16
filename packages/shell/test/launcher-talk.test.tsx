/**
 * The launcher as the conversation (decisions.md D261, the design's
 * direction A): Ask Dashi (⇥, or its row) sends the words to Dashi's agent
 * and the launcher becomes the thread with the field at the bottom; the
 * answer streams in under the persona's mark with its step lines; Return
 * sends a follow-up; a critical step's Yes and No are one line and Return
 * is yes; ❖Esc stops, ❖↩ keeps it working; Esc closes and the conversation
 * stays. An empty ⇥ shows what can be asked.
 */

import { afterEach, expect, test } from "bun:test";
import { ANSWERERS } from "../src/agents/ask/answerer.ts";
import { Transcript, type TurnPen } from "../src/agents/assistant/transcript.ts";
import type { PersonAnswer } from "../src/agents/presence.ts";
import { LauncherKeys } from "../src/launcher/keys.ts";
import { ASK_ROW } from "../src/launcher/lib/agents/agent-rows.ts";
import { blocksOf, FIRST_TRIES, spansOf, talkHints, talkSubmit, tries } from "../src/launcher/lib/talk/talk-mode.ts";
import type { LauncherAgents, LauncherAgentsSnapshot, LauncherDashi } from "../src/launcher/types.ts";
import { app, mount, unmountLauncher } from "./launcher-harness.tsx";
import { settle } from "./support/time.ts";

afterEach(unmountLauncher);

const SNAP: LauncherAgentsSnapshot = { answerer: ANSWERERS["claude-code"], unset: false, now: [], tasks: [] };
const agents = {
  subscribe: () => () => {},
  getSnapshot: () => SNAP,
  history: () => [],
  closed: () => {},
  signIn: () => {},
  setUp: () => {},
} as unknown as LauncherAgents;

function fakeDashi(recent: string[] = []) {
  const transcript = new Transcript(() => 1000);
  const typed: string[] = [];
  const replies: PersonAnswer[] = [];
  const counts = { stop: 0, keep: 0 };
  let pen: TurnPen | null = null;
  const dashi: LauncherDashi & { pen: () => TurnPen | null } = {
    subscribe: transcript.subscribe,
    getSnapshot: transcript.getSnapshot,
    type(words) {
      typed.push(words);
      pen = transcript.begin("c1", words, "typing", "Claude Code · opus");
      return true;
    },
    stop() {
      counts.stop++;
      pen?.end("stopped");
    },
    keepWorking() {
      counts.keep++;
      transcript.setBackground(true);
      return true;
    },
    reply(answer) {
      replies.push(answer);
      return transcript.reply(answer);
    },
    model: () => "Claude Code · opus",
    name: () => "Dashi",
    recent: () => recent,
    openLink: () => {},
    pen: () => pen,
  };
  return { dashi, transcript, typed, replies, counts };
}

test("⇥ on words: they go to Dashi's agent and the launcher is the conversation, the answer streaming under the mark", async () => {
  const fake = fakeDashi();
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [app("Terminal")], agents, dashi: fake.dashi, keys }, [ASK_ROW]);
  await launcher.type("open Helium and go to YouTube");
  keys.binding("launcher-tab");
  await settle();
  expect(fake.typed).toEqual(["open Helium and go to YouTube"]);
  expect(launcher.has("talk:thread")).toBe(true);
  expect(launcher.has("talk:model")).toBe(true);
  expect(launcher.tree()).toContain("Claude Code · opus");
  fake.dashi.pen()?.step("Opening youtube.com");
  fake.dashi.pen()?.settle(true);
  fake.dashi.pen()?.step("Reading the page");
  fake.dashi.pen()?.say("Opening YouTube in Helium.");
  await settle();
  expect(launcher.tree()).toContain("Opening youtube.com");
  expect(launcher.tree()).toContain("Opening YouTube in Helium.");
  expect(launcher.has("talk:stop")).toBe(true);
  expect(launcher.tree()).toContain("Keep working on it");
  fake.dashi.pen()?.end("done");
  await settle();
  // Done: the steps fold into one line, a press opens them.
  expect(launcher.has("talk:steps-folded")).toBe(true);
  expect(launcher.tree()).toContain("2 steps");
});

test("Return in the field sends a follow-up in the same view; Esc closes the launcher and stops nothing", async () => {
  const fake = fakeDashi();
  const launcher = await mount({ entries: [], agents, dashi: fake.dashi, conversation: true });
  await launcher.type("what's the weather in Bogotá?");
  await launcher.enter();
  fake.dashi.pen()?.end("done", { text: "14 °C and cloudy." });
  await launcher.type("and tomorrow?");
  await launcher.enter();
  expect(fake.typed).toEqual(["what's the weather in Bogotá?", "and tomorrow?"]);
  await launcher.key("Escape");
  expect(launcher.closed).toHaveLength(1);
  expect(fake.counts.stop).toBe(0);
});

test("❖Esc stops the turn at work; ❖↩ keeps it working on its own and says so", async () => {
  const fake = fakeDashi();
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [], agents, dashi: fake.dashi, keys, conversation: true });
  await launcher.type("find three flights");
  await launcher.enter();
  expect(keys.extrasWanted.stopWork).toBe(true);
  keys.binding("launcher-secondary");
  await settle();
  expect(fake.counts.keep).toBe(1);
  expect(launcher.has("talk:background")).toBe(true);
  keys.binding("launcher-stop-work");
  await settle();
  expect(fake.counts.stop).toBe(1);
});

test("a critical step asks on one line: No and Yes, and Return is yes; words typed instead are a no and the next turn", async () => {
  const fake = fakeDashi();
  const launcher = await mount({ entries: [], agents, dashi: fake.dashi, conversation: true });
  await launcher.type("quit Helium");
  await launcher.enter();
  const asked = fake.transcript.ask({ text: "Force quit Helium?", kind: "yes-no", yes: "Force Quit" }, 120, new AbortController().signal);
  await settle();
  expect(launcher.has("talk:waiting")).toBe(true);
  expect(launcher.has("talk:yes")).toBe(true);
  expect(launcher.tree()).toContain("Or type what to do instead");
  await launcher.enter();
  expect(await asked).toEqual({ text: "yes", by: "typing" });
  fake.transcript.ask({ text: "Force quit Helium?", kind: "yes-no" }, 120, new AbortController().signal);
  await settle();
  await launcher.type("close it instead");
  await launcher.enter();
  expect(fake.replies.at(-1)).toEqual({ text: "no", by: "typing" });
  expect(fake.typed.at(-1)).toBe("close it instead");
});

test("an empty ⇥ shows what can be asked: the person's recent asks, else a few to try; Return sends the one selected", async () => {
  const fresh = fakeDashi();
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [], agents, dashi: fresh.dashi, keys }, []);
  keys.binding("launcher-tab");
  await settle();
  expect(launcher.has("talk:empty")).toBe(true);
  expect(launcher.tree()).toContain(FIRST_TRIES[0] ?? "");
  await launcher.key("ArrowDown");
  await launcher.enter();
  expect(fresh.typed).toEqual([FIRST_TRIES[1] ?? ""]);
  expect([...tries(["turn on dark mode", "turn on dark mode", " "])]).toEqual(["turn on dark mode"]);
});

test("a conversation started by voice shows its spoken turns as said", async () => {
  const fake = fakeDashi();
  fake.transcript.begin("c1", "Can you open Helium and go to YouTube?", "voice", "Claude Code · sonnet").end("done", { text: "YouTube is open in Helium." });
  const launcher = await mount({ entries: [], agents, dashi: fake.dashi, conversation: true });
  expect(launcher.tree()).toContain("Said");
  expect(launcher.tree()).toContain("spoken");
  expect(launcher.tree()).toContain("Started by voice");
  expect(launcher.tree()).toContain("YouTube is open in Helium.");
});

test("Return's choices, the hints, and the answer's words as blocks and links", () => {
  const empty = new Transcript().getSnapshot();
  expect(talkSubmit(empty, " hi ")).toEqual({ kind: "send", text: "hi" });
  expect(talkSubmit({ ...empty, waiting: { id: 1, text: "?", kind: "yes-no" } }, "")).toEqual({ kind: "yes" });
  expect(talkSubmit({ ...empty, waiting: { id: 1, text: "?", kind: "words" } }, "the blue one")).toEqual({ kind: "answer", text: "the blue one" });
  const failed = {
    ...empty,
    turns: [
      {
        kind: "dashi" as const,
        id: 2,
        by: "typing" as const,
        text: "Not signed in.",
        steps: [],
        state: "failed" as const,
        model: "",
        failed: { go: "launcher" as const },
      },
    ],
  };
  expect(talkSubmit(failed, "")).toEqual({ kind: "sign-in" });
  expect(talkHints({ ...empty, working: true }, "").map((hint) => hint.keys)).toEqual(["❖↩", "❖Esc"]);
  expect(blocksOf("First.\n\n- one\n- two\n1. three\n```\ncode\n```")).toEqual([
    { kind: "paragraph", text: "First." },
    { kind: "item", text: "one", mark: "•" },
    { kind: "item", text: "two", mark: "•" },
    { kind: "item", text: "three", mark: "1." },
    { kind: "code", text: "code" },
  ]);
  expect(spansOf("See [YouTube](https://youtube.com) or https://example.com, run `ls`.")).toEqual([
    { text: "See " },
    { text: "YouTube", url: "https://youtube.com" },
    { text: " or " },
    { text: "https://example.com", url: "https://example.com" },
    { text: ", run " },
    { text: "ls", code: true },
    { text: "." },
  ]);
});
