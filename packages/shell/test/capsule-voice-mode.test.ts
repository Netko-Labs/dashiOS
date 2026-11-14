/**
 * Voice mode over 0.8's loop (src/capsule/lib/voice-mode.ts), driven by the
 * fake voice controller and tasks (lib/fake.ts): the states the capsule is
 * told, the asks, which card opens, and what counts as a yes.
 */

import { expect, test } from "bun:test";
import { CARD_ARM_MS } from "../src/shared/pill/index.ts";
import { stage } from "./support/capsule.ts";
import { flush } from "./support/time.ts";

test("the chip's states become voice mode's, and the level follows the microphone", () => {
  const { hub, voice, phase } = stage();
  expect(phase()).toBe("idle");
  voice.show({ kind: "listening", text: "turn on", question: false });
  expect(hub.voiceMode.getSnapshot()).toEqual({ phase: "listening", text: "turn on", answering: false });
  voice.level.set(0.6);
  expect(hub.level.getSnapshot()).toBe(0.6);
  voice.show({ kind: "thinking", text: "turn on dark mode" });
  expect(hub.voiceMode.getSnapshot()).toEqual({ phase: "heard", text: "turn on dark mode" });
  voice.show({ kind: "speaking", words: ["Done", "now"], at: 0, full: "Done now" });
  expect(phase()).toBe("answer");
  voice.show({ kind: "notice", text: "No agent answers yet.", go: "agents" });
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "notice", line: "No agent answers yet.", go: "agents" });
  voice.show(null);
  expect(phase()).toBe("idle");
});

test("the level is dictation's while it dictates", () => {
  const { hub, voice } = stage();
  hub.dictation.set({ phase: "listening", text: "", handsFree: false, endsAt: null, hint: null });
  hub.level.set(0.2);
  voice.level.set(0.9);
  expect(hub.level.getSnapshot()).toBe(0.2);
});

test("the Dashi key going down shows at once, and a chord takes it away", () => {
  const { hub, phase } = stage();
  hub.keys.send({ key: "dashi", gesture: "down", at: 0 });
  expect(phase()).toBe("key-down");
  hub.keys.send({ key: "dashi", gesture: "chord", at: 10 });
  expect(phase()).toBe("idle");
  hub.keys.send({ key: "dictation", gesture: "down", at: 20 });
  expect(phase()).toBe("idle");
});

test("a spoken plan is an ask whose card opens by itself and says how to say yes", () => {
  const { hub, voice, tasks, state, say, advance } = stage();
  const id = say("Turn on Dark Mode");
  tasks.settle(id, ["Turn Dark Mode on"], "Sure.");
  voice.show(null);
  expect(hub.asks.getSnapshot()).toEqual([
    { kind: "permission", id, task: id, request: "Turn on Dark Mode", steps: ["Turn Dark Mode on"], spoken: true, since: 1000 },
  ]);
  expect(state.card).toMatchObject({ what: { ask: { id } }, keyboard: false, armsAt: 1000 + CARD_ARM_MS, hears: true });
  // A moment later, never in the voice loop's own turn (it would stop the task).
  expect(voice.said).toBe("");
  advance(0);
  expect(voice.said).toBe("Sure. I would turn Dark Mode on. Say yes, or press Yes.");
});

test("a typed plan is an ask, and its card waits for the bar", () => {
  const { hub, tasks, state } = stage();
  const id = tasks.ask("Open Files");
  tasks.settle(id, ["Open “Files”"]);
  expect(hub.asks.getSnapshot()).toMatchObject([{ id, spoken: false }]);
  expect(state.card).toBeNull();
  hub.voiceCommands.send({ do: "open-ask", id: "spoken" });
  expect(state.card).toBeNull();
  hub.voiceCommands.send({ do: "open-ask", id });
  expect(state.card).toMatchObject({ what: { ask: { id } }, hears: false });
});

test("a yes before the buttons arm answers nothing; after, the plan runs if the person pressed", async () => {
  const { hub, voice, tasks, state, say, advance, phase } = stage({ pressed: () => true });
  const id = say("Turn on Dark Mode and open Notes");
  tasks.settle(id, ["Turn Dark Mode on", "Open “Notes”"]);
  voice.show(null);
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("planned");
  expect(state.card).not.toBeNull();
  advance(CARD_ARM_MS);
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("running");
  expect(state.card).toBeNull();
  expect(hub.asks.getSnapshot()).toEqual([]);
  advance(1);
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "step", title: "Turn Dark Mode on", index: 0, of: 2, task: id });
  advance(1000);
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "step", title: "Open “Notes”", index: 1 });
  advance(1001);
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "done", line: "Done: 2 steps" });
  advance(4000);
  expect(phase()).toBe("idle");
});
test("a press the compositor can't say was the person's runs nothing, and says so", async () => {
  const { hub, voice, tasks, say, advance } = stage({ pressed: () => false });
  const id = say("Lock the screen");
  tasks.settle(id, ["Lock the screen"]);
  voice.show(null);
  advance(CARD_ARM_MS);
  hub.voiceCommands.send({ do: "answer-permission", id, yes: true });
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("planned");
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "notice", go: "launcher" });
  expect(hub.asks.getSnapshot()).toEqual([]);
});

test("the Dashi key held and yes said, as the whole of it, runs the plan; anything else asks again", async () => {
  const { voice, tasks, state, say, advance } = stage();
  const id = say("Lock the screen");
  tasks.settle(id, ["Lock the screen"]);
  voice.show(null);
  advance(0);
  expect(voice.hear("yes but later")).toBe(true);
  expect(tasks.getSnapshot()[0]?.phase).toBe("planned");
  advance(0);
  expect(voice.said).toBe("Say yes or no.");
  // Said before the buttons armed: a voice is not a stray click.
  expect(voice.hear("Yes.")).toBe(true);
  await flush();
  expect(tasks.getSnapshot()[0]?.phase).toBe("running");
  expect(state.card).toBeNull();
});

test("a spoken yes is the yes of the plan it answered: it runs no other task, and counts once", async () => {
  const { tasks, state, say, voice, advance } = stage();
  const id = say("Lock the screen");
  tasks.settle(id, ["Lock the screen"]);
  const other = tasks.ask("Empty the Trash");
  tasks.settle(other, ["Empty the Trash"]);
  voice.show(null);
  advance(0);
  expect(voice.hear("yes")).toBe(true);
  // Another task asks to run in the same breath: the yes was not for it.
  expect(state.mode?.saidYes(other)).toBe(false);
  await tasks.run(other);
  expect(tasks.getSnapshot().find((task) => task.id === other)?.phase).toBe("planned");
  await flush();
  expect(tasks.getSnapshot().find((task) => task.id === id)?.phase).toBe("running");
  expect(state.mode?.saidYes(id)).toBe(false);
});

test("a no stops the task and says Stopped", () => {
  const { hub, voice, tasks, state, say, advance, phase } = stage();
  const id = say("Lock the screen");
  tasks.settle(id, ["Lock the screen"]);
  voice.show(null);
  advance(0);
  voice.hear("no");
  expect(tasks.getSnapshot()[0]?.phase).toBe("stopped");
  expect(state.card).toBeNull();
  expect(phase()).toBe("stopped");
  advance(2500);
  expect(phase()).toBe("idle");
  expect(hub.asks.getSnapshot()).toEqual([]);
});

test("a tap of the Dashi key gives an open card the keyboard, and only then", () => {
  const { hub, tasks, state, say, mode } = stage();
  hub.keys.send({ key: "dashi", gesture: "tap", at: 0 });
  expect(state.card).toBeNull();
  const id = say("Lock the screen");
  tasks.settle(id, ["Lock the screen"]);
  expect(state.card?.keyboard).toBe(false);
  hub.keys.send({ key: "dashi", gesture: "tap", at: 5 });
  expect(state.card?.keyboard).toBe(true);
  mode.cardAction("unfocus");
  expect(state.card?.keyboard).toBe(false);
});

test("the oldest ask is the card, one at a time", async () => {
  const { tasks, state, say, voice, advance } = stage();
  const first = say("Lock the screen");
  tasks.settle(first, ["Lock the screen"]);
  advance(10);
  const second = say("Open Notes");
  tasks.settle(second, ["Open “Notes”"]);
  voice.show(null);
  expect(state.card).toMatchObject({ what: { ask: { id: first } } });
  advance(0);
  voice.hear("no");
  expect(state.card).toMatchObject({ what: { ask: { id: second } } });
});

test("Type it instead stops the ask and lands the words as a dictation", () => {
  const { hub, voice, tasks, say, phase } = stage();
  const typed: unknown[] = [];
  say("the release notes are almost done");
  hub.voiceCommands.send({ do: "type-instead" });
  // Nobody types yet (core is not merged): it says so and types nothing.
  expect(hub.voiceMode.getSnapshot()).toMatchObject({ phase: "notice", go: "voice" });
  hub.dictationCommands.handle((command) => void typed.push(command));
  voice.show({ kind: "thinking", text: "the release notes are almost done" });
  hub.voiceCommands.send({ do: "type-instead" });
  expect(typed).toEqual([{ do: "type", text: "the release notes are almost done" }]);
  expect(voice.getSnapshot()).toBeNull();
  expect(phase()).toBe("idle");
  expect(tasks.getSnapshot()).toHaveLength(1);
});

test("Stop stops the voice and the task", () => {
  const { hub, voice, tasks, say, phase } = stage();
  const id = say("Lock the screen");
  hub.voiceCommands.send({ do: "stop", task: id });
  expect(voice.getSnapshot()).toBeNull();
  expect(tasks.getSnapshot()[0]?.phase).toBe("stopped");
  expect(phase()).toBe("stopped");
});

test("❖Esc stops what Dashi says and every task of its at work, and is nothing when there is none", () => {
  const { hub, voice, tasks, say, phase } = stage();
  hub.voiceCommands.send({ do: "stop", all: true });
  expect(phase()).toBe("idle");
  const spoken = say("Lock the screen");
  const typed = tasks.ask("Open Files");
  const waits = tasks.ask("Turn on Dark Mode");
  tasks.settle(waits, ["Turn Dark Mode on"]);
  hub.voiceCommands.send({ do: "stop", all: true });
  expect(voice.getSnapshot()).toBeNull();
  const phaseOf = (id: string): string | undefined => tasks.getSnapshot().find((task) => task.id === id)?.phase;
  expect([phaseOf(spoken), phaseOf(typed)]).toEqual(["stopped", "stopped"]);
  // A plan that waits for a yes is not at work: its card stays.
  expect(phaseOf(waits)).toBe("planned");
  expect(phase()).toBe("stopped");
});

test("an agent's question opens by itself, is said, and the next words heard answer it", async () => {
  const { hub, voice, mode, state, advance } = stage();
  const answer = mode.questions.ask({ who: "Claude Code", text: "Which branch?", spoken: "Claude Code asks: Which branch?", seconds: 60 });
  expect(hub.asks.getSnapshot()).toMatchObject([{ kind: "question", text: "Which branch?", who: "Claude Code", choices: [] }]);
  expect(state.card).toMatchObject({ hears: true });
  advance(0);
  expect(voice.said).toBe("Claude Code asks: Which branch?");
  voice.hear("the release branch");
  expect(await answer).toEqual({ text: "the release branch", by: "voice" });
  expect(state.card).toBeNull();
});

test("a question can be skipped, typed elsewhere, or run out of time", async () => {
  const { hub, mode, advance } = stage();
  const question = { who: "Codex", text: "Which one?", spoken: "", seconds: 30 };
  const skipped = mode.questions.ask(question);
  hub.voiceCommands.send({ do: "answer-question", id: hub.asks.getSnapshot()[0]?.id ?? "", text: "" });
  expect(await skipped).toEqual({ none: "declined" });
  const typed = mode.questions.ask(question);
  mode.cardAction("read");
  expect(await typed).toBe("elsewhere");
  const late = mode.questions.ask(question);
  advance(30_000);
  expect(await late).toEqual({ none: "no-answer" });
  expect(hub.asks.getSnapshot()).toEqual([]);
});
