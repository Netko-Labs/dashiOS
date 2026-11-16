/**
 * One Dashi agent, by voice or typed (decisions.md D261, D262): a typed ask
 * goes to the same loop and the same conversation as a spoken one, both are
 * in the one transcript the launcher shows, a typed turn's question waits
 * on the launcher's line, Keep working on it lets the turn go on by itself
 * and says when it is done, and each turn uses its own channel's model.
 */

import { expect, test } from "bun:test";
import type { DashiTurn } from "../src/agents/assistant/index.ts";
import { modelFor, modelLabel } from "../src/agents/assistant/lib/channel.ts";
import { KEEP_CALLS } from "../src/agents/assistant/lib/turn.ts";
import { fakeAssistant } from "./support/assistant.ts";
import { settle, until } from "./support/time.ts";

const OPEN = [{ say: "Opening YouTube.", calls: [{ name: "open_url", arguments: { url: "https://youtube.com" } }] }, { say: "YouTube is open." }];

const lastDashi = (turns: readonly { kind: string }[]): DashiTurn | undefined => turns.findLast((turn): turn is DashiTurn => turn.kind === "dashi");

test("a typed ask goes to the assistant's loop, in the conversation's id, and the launcher's transcript has it all", async () => {
  const fake = fakeAssistant([...OPEN]);
  expect(fake.assistant.type("open Helium and go to YouTube")).toBe(true);
  await until(() => fake.assistant.transcript.getSnapshot().working === false && fake.sent.length === 2);
  await settle();
  const view = fake.assistant.transcript.getSnapshot();
  expect(view.conversation).toBe("talk000001");
  expect(fake.assistant.talk.id).toBe("talk000001");
  expect(fake.ran).toEqual(["open_url"]);
  expect(view.turns[0]).toMatchObject({ kind: "person", text: "open Helium and go to YouTube", by: "typing" });
  const answer = lastDashi(view.turns);
  expect(answer).toMatchObject({ by: "typing", state: "done", model: "Local model · its default" });
  expect(answer?.steps).toEqual([{ title: "Opening youtube.com", ok: true }]);
  expect(answer?.text).toContain("Opening YouTube.");
  expect(answer?.text).toContain("YouTube is open.");
  // Typed: nothing is said out loud, unless the person asks for it.
  expect(fake.spoken).toEqual([]);
  expect(fake.log.at(-1)).toContain('by=typing way=model model="Local model · its default"');
});

test("voice, then typed, then voice again: one conversation, the spoken turns shown with the typed", async () => {
  const fake = fakeAssistant([{ say: "YouTube is open." }, { say: "Searching." }, { say: "Playing it." }]);
  await fake.ask("open YouTube");
  const id = fake.assistant.talk.id;
  fake.assistant.type("search for lo-fi");
  await until(() => fake.sent.length === 2 && !fake.assistant.transcript.getSnapshot().working);
  await fake.ask("play the first one");
  expect(fake.assistant.talk.id).toBe(id);
  // The model was sent the earlier turns each time.
  expect(fake.sent[2]?.messages.filter((message) => message.role === "user")).toHaveLength(3);
  const turns = fake.assistant.transcript.getSnapshot().turns;
  expect(turns.filter((turn) => turn.kind === "person").map((turn) => (turn.kind === "person" ? turn.by : ""))).toEqual(["voice", "typing", "voice"]);
});

test("Keep working on it: the turn gets room for a longer job, goes on by itself, and a notification says it is done", async () => {
  const fake = fakeAssistant([{ say: "Looking at Avianca first.", calls: [{ name: "read_page" }] }, { say: "Found three flights." }]);
  fake.onCall = () => {
    expect(fake.assistant.keepWorking()).toBe(true);
    expect(fake.assistant.background("talk000001")).toBe(true);
    expect(fake.assistant.transcript.getSnapshot().background).toBe(true);
  };
  fake.assistant.type("find three flights to Medellín");
  await until(() => fake.done.length === 1);
  expect(fake.done[0]).toEqual({ title: "Done", body: "Found three flights." });
  expect(fake.log.at(-1)).toContain("background");
  expect(fake.assistant.background("talk000001")).toBe(false);
  expect(KEEP_CALLS).toBeGreaterThan(25);
  // Nothing at work: nothing to keep working.
  expect(fake.assistant.keepWorking()).toBe(false);
});

test("❖Esc in the launcher stops the typed turn; the conversation stays open", async () => {
  const fake = fakeAssistant([{ calls: [{ name: "read_page" }] }, { say: "never" }]);
  fake.onCall = () => fake.assistant.stop();
  fake.assistant.type("read every heading");
  await until(() => !fake.assistant.transcript.getSnapshot().working && fake.talkLog.length > 0);
  expect(lastDashi(fake.assistant.transcript.getSnapshot().turns)?.state).toBe("stopped");
  expect(fake.assistant.talk.open()).toBe(true);
});

test("a typed turn's critical question waits on the launcher's line; Return's yes answers it", async () => {
  const fake = fakeAssistant([{ calls: [{ name: "read_page" }] }, { say: "Done." }]);
  const answered: { value: boolean | null } = { value: null };
  fake.onCall = async () => {
    const gate = fake.assistant.policy("talk000001")?.assistant;
    const line = gate?.confirm?.({ summary: "force quit Helium", detail: "", action: "Force Quit", danger: true }, new AbortController().signal) ?? null;
    expect(line).not.toBeNull();
    expect(fake.assistant.transcript.getSnapshot().waiting).toMatchObject({ kind: "yes-no", text: "Force quit Helium?", yes: "Force Quit" });
    fake.assistant.reply({ text: "yes", by: "typing" });
    answered.value = (await line) ?? null;
  };
  fake.assistant.type("quit Helium, it's stuck");
  await until(() => answered.value !== null);
  expect(answered.value).toBe(true);
});

test("a spoken turn's question is not the launcher's: it goes to the capsule and the sheets as before", async () => {
  const fake = fakeAssistant([{ calls: [{ name: "read_page" }] }, { say: "Done." }]);
  let line: Promise<boolean> | null | "unset" = "unset";
  fake.onCall = () => {
    line = fake.assistant.policy("talk000001")?.assistant?.confirm?.({ summary: "x", detail: "", action: "Do it" }, new AbortController().signal) ?? null;
  };
  await fake.ask("do it");
  expect(line).toBeNull();
});

test("each turn uses its own channel's model: typed and spoken may differ, spoken falls back to typed (D262)", async () => {
  expect(modelFor({ "claude-code": { typed: "opus", spoken: "haiku" } }, "claude-code", "typing")).toBe("opus");
  expect(modelFor({ "claude-code": { typed: "opus", spoken: "haiku" } }, "claude-code", "voice")).toBe("haiku");
  expect(modelFor({ "claude-code": { typed: "opus" } }, "claude-code", "voice")).toBe("opus");
  expect(modelFor({ "claude-code": { typed: "opus", spoken: "default" } }, "claude-code", "voice")).toBeNull();
  expect(modelFor(undefined, "local", "voice", "qwen3:8b")).toBe("qwen3:8b");
  expect(modelLabel("claude-code", null)).toBe("Claude Code · its default");
  const fake = fakeAssistant([{ say: "One." }, { say: "Two." }]);
  fake.state.models = { local: { typed: "big:70b", spoken: "fast:3b" } };
  await fake.ask("hello");
  fake.assistant.type("and again");
  await until(() => fake.sent.length === 2 && !fake.assistant.transcript.getSnapshot().working);
  expect(fake.sent.map((sent) => sent.model)).toEqual(["fast:3b", "big:70b"]);
  expect(fake.log.filter((line) => line.startsWith("assistant asked")).map((line) => /model="([^"]*)"/.exec(line)?.[1])).toEqual([
    "Local model · fast:3b",
    "Local model · big:70b",
  ]);
  expect(fake.assistant.model("typing")).toBe("Local model · big:70b");
});

test("“Read typed answers aloud” on: a typed answer is said too", async () => {
  const fake = fakeAssistant([{ say: "It is 14 degrees." }]);
  fake.state.readTyped = true;
  fake.assistant.type("weather in Bogotá?");
  await until(() => fake.spoken.length === 1);
  expect(fake.spoken).toEqual(["It is 14 degrees."]);
});
