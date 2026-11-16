/**
 * Dashi's assistant in a loop (agents/assistant/; decisions.md D147, D148):
 * what is said is done with the tools, one call at a time, each result read
 * before the next; the words are told as they come; while the conversation
 * is open everything said continues it; an ask is held to its limits; and
 * "undo that" and the words that end the conversation are rules, not a
 * model's guess. The model here answers from a script.
 */

import { expect, test } from "bun:test";
import { wayOf } from "../src/agents/assistant/assistant.ts";
import { CAP_WORDS } from "../src/agents/assistant/lib/running.ts";
import { asksUndo, endsTalk } from "../src/agents/assistant/lib/words.ts";
import { fakeAssistant } from "./support/assistant.ts";
import { settle } from "./support/time.ts";

const YOUTUBE = [
  { say: "Opening YouTube in Helium.", calls: [{ name: "open_url", arguments: { url: "https://www.youtube.com" } }] },
  { calls: [{ name: "read_page" }] },
  { say: "YouTube is open in Helium." },
];

test("“open Helium and go to YouTube”: a line, the calls one by one with each result read, and a sentence that says what happened", async () => {
  const fake = fakeAssistant([...YOUTUBE]);
  const answer = await fake.ask("So just can you open Helium and go to YouTube?");
  expect(fake.ran).toEqual(["open_url", "read_page"]);
  // Three requests: the model read what each call returned before the next.
  expect(fake.sent).toHaveLength(3);
  expect(fake.sent[2]?.messages.at(-1)).toMatchObject({ role: "tool", content: "YouTube\n[1] Search (text field)" });
  expect(fake.said.join("").replace(/\s+/g, " ").trim()).toBe("Opening YouTube in Helium. YouTube is open in Helium.");
  expect(fake.steps).toEqual(["Opening youtube.com", "Reading the page"]);
  expect(answer).toEqual({ say: "" });
  // The first request carries the words, then what is in front and the apps, after them.
  const first = fake.sent[0]?.messages.at(-1)?.content ?? "";
  expect(first.startsWith("So just can you open Helium and go to YouTube?\n\n")).toBe(true);
  expect(first).toContain("In front: Helium");
  expect(first).toContain("Apps installed: Calendar, Helium, Notes.");
  expect(first).toContain("may be misheard");
  // The browser's tools are offered: the full server's, not a plan's thirty.
  expect(fake.sent[0]?.tools).toEqual(expect.arrayContaining(["open_url", "read_page", "fill_element", "ask_person"]));
  expect(fake.history).toMatchObject([
    { request: "So just can you open Helium and go to YouTube?", steps: [{ title: "Opening youtube.com" }, { title: "Reading the page" }] },
  ]);
});

test("a follow-up continues the same conversation: the model is sent what was said before, and the apps are not sent twice", async () => {
  const fake = fakeAssistant([
    ...YOUTUBE,
    { say: "Searching.", calls: [{ name: "fill_element", arguments: { ref: 1, text: "lo-fi" } }] },
    { say: "Here are lo-fi videos." },
  ]);
  await fake.ask("open Helium and go to YouTube");
  expect(fake.assistant.talk.open()).toBe(true);
  const id = fake.assistant.talk.id;
  await fake.ask("search for lo-fi");
  expect(fake.assistant.talk.id).toBe(id);
  const second = fake.sent[3]?.messages ?? [];
  expect(second.map((message) => message.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "tool", "assistant", "user"]);
  expect(second.at(-1)?.content).not.toContain("Apps installed");
  expect(fake.ran).toEqual(["open_url", "read_page", "fill_element"]);
  expect(fake.talkLog.map((line) => line.asked)).toEqual(["open Helium and go to YouTube", "search for lo-fi"]);
  expect(fake.talkLog.every((line) => line.conversation === "talk000001")).toBe(true);
});

test("“that's all” ends it by rule, in English and Spanish, and the next thing said starts a new one", async () => {
  expect(["that's all", "Thanks, that's all.", "OK, new topic", "Forget that.", "Eso es todo, gracias", "olvídalo", "nuevo tema"].every(endsTalk)).toBe(true);
  expect(["that's all I can think of for the list", "open a new topic in the forum", "forget that file"].some(endsTalk)).toBe(false);
  const fake = fakeAssistant([{ say: "Hello." }, { say: "Hello again." }]);
  await fake.ask("hello");
  expect(await fake.ask("Thanks, that's all.")).toEqual({ say: "OK." });
  expect(fake.assistant.talk.open()).toBe(false);
  expect(fake.sent).toHaveLength(1);
  await fake.ask("hello");
  // A new conversation: nothing of the first goes with it.
  expect(fake.sent[1]?.messages.map((message) => message.role)).toEqual(["system", "user"]);
});

test("25 calls an ask, here 2: the next is refused in words the model reads, so it says where it is", async () => {
  const fake = fakeAssistant(
    [
      { calls: [{ name: "read_page" }] },
      { calls: [{ name: "read_page" }] },
      { calls: [{ name: "read_page" }] },
      { say: "I read the page twice and stopped there." },
    ],
    { maxCalls: 2 },
  );
  await fake.ask("keep reading");
  expect(fake.ran).toEqual(["read_page", "read_page"]);
  expect(fake.sent[3]?.messages.at(-1)?.content).toBe(CAP_WORDS);
  expect(fake.said.join("")).toContain("stopped there");
});

test("two minutes an ask: then Dashi stops it and says where it is; the time a question waits on the person is not counted", async () => {
  const fake = fakeAssistant([
    { calls: [{ name: "ask_person", arguments: { question: "Which one?" } }] },
    { calls: [{ name: "read_page" }] },
    { say: "never said" },
  ]);
  let waits = 0;
  fake.onCall = (name) => {
    // The question waits three minutes on the person: the ask goes on after it.
    fake.state.now += 180_000;
    fake.timers.advance(180_000);
    if (name === "read_page" && waits++ === 0) fake.timers.advance(1);
  };
  const answer = await fake.ask("do the thing");
  expect(fake.ran).toEqual(["ask_person"]);
  expect(answer.say).toBe("I ran out of time. I got as far as: reading the page. Ask me to go on if you want.");
  expect(fake.log.at(-1)).toContain("ended=time");
});

test("stopped mid-loop: nothing more runs or is said, and what was heard stays in the conversation as interrupted", async () => {
  const fake = fakeAssistant([
    { say: "Opening it.", calls: [{ name: "open_url", arguments: { url: "https://example.com" } }, { name: "read_page" }] },
    { say: "never said" },
    { say: "The other one, then." },
  ]);
  const stop = new AbortController();
  fake.onCall = () => stop.abort();
  expect(await fake.ask("open the site", stop.signal)).toEqual({ say: "" });
  expect(fake.ran).toEqual([]);
  expect(fake.talkLog[0]).toMatchObject({ asked: "open the site", interrupted: true });
  fake.onCall = () => {};
  await fake.ask("no, the other one");
  const roles = fake.sent.at(-1)?.messages.map((message) => `${message.role}:${message.content.slice(0, 24)}`) ?? [];
  expect(roles.slice(1, 3)).toEqual(["user:open the site\n\n(Not said", "assistant:Opening it. (interrupted"]);
});

test("a settings change offers undo, and “undo that” puts it back without asking the model", async () => {
  expect(["undo that", "Undo.", "deshaz eso", "OK, undo that please"].every(asksUndo)).toBe(true);
  expect(asksUndo("undo the last three commits")).toBe(false);
  const fake = fakeAssistant([
    { say: "Turning Dark Mode on.", calls: [{ name: "set_setting", arguments: { name: "dark_mode", value: true } }] },
    { say: "Dark Mode is on." },
  ]);
  expect(await fake.ask("dark mode please")).toEqual({ say: "Say undo that to put it back." });
  expect(await fake.ask("undo that")).toEqual({ say: "Done. I put that back." });
  expect(fake.undone).toHaveLength(1);
  expect(fake.sent).toHaveLength(2);
  expect(await fake.ask("undo that")).toEqual({ say: "There is nothing to undo." });
});

test("GPT keeps plan mode by voice only; no answerer asks nothing; a harness and a key or a local model loop (D261)", async () => {
  expect([wayOf("claude-code"), wayOf("codex"), wayOf("claude"), wayOf("local")]).toEqual(["harness", "harness", "model", "model"]);
  expect([wayOf("gpt"), wayOf(undefined), wayOf("none")]).toEqual(["plan", "none", "none"]);
  const fake = fakeAssistant([]);
  fake.state.answerer = "gpt";
  expect(await fake.ask("open Helium")).toEqual({ say: "planned: open Helium" });
  expect(fake.sent).toHaveLength(0);
  expect(fake.assistant.type("open Helium")).toBe(true);
  await settle();
  const last = fake.assistant.transcript.getSnapshot().turns.at(-1);
  expect(last?.kind === "dashi" && last.text).toContain("Not yet: GPT needs Dashi's loop");
});

test("locked, nothing is asked; no first-use sheet: the first ask just runs (D260)", async () => {
  const locked = fakeAssistant([{ say: "never" }]);
  locked.state.locked = true;
  expect(await locked.ask("open Helium")).toEqual({ say: "" });
  expect(locked.sent).toHaveLength(0);
  const first = fakeAssistant([{ say: "Hello." }]);
  await first.ask("hello");
  expect(first.sent).toHaveLength(1);
});
