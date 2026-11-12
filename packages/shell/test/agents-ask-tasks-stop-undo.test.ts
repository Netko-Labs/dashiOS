import { expect, test } from "bun:test";
import { ANSWERERS, type Answerer } from "../src/agents/ask/answerer.ts";
import { readHistory } from "../src/agents/ask/history.ts";
import { darkAndDock, fakeAnswerer, harness } from "./support/agents-ask-tasks.ts";
import { settle } from "./support/time.ts";

test("a failed ask's history line says why; the plan a Retry made replaces it", () => {
  const files = {
    tasks: [
      JSON.stringify({ v: 1, task: "ask-1.1", time: 10, agent: "Claude Code", request: "turn on wifi", steps: [], failure: "Claude Code didn't answer." }),
      JSON.stringify({ v: 1, task: "ask-2.1", time: 20, agent: "Claude Code", request: "dark mode", steps: [], failure: "Not signed in." }),
      JSON.stringify({ v: 1, task: "ask-2.1", time: 21, agent: "Claude Code", request: "dark mode", steps: [{ title: "Turn Dark Mode on", outcome: "done" }] }),
    ].join("\n"),
    activity: "",
  };
  expect(readHistory(files).map((entry) => [entry.id, entry.summary])).toEqual([
    ["ask-2.1", "Turn Dark Mode on"],
    ["ask-1.1", "Claude Code didn't answer."],
  ]);
});

test("Stop while asking drops the answer; Stop while running skips what hasn't started", async () => {
  const silent: Answerer = { info: ANSWERERS.local, turn: () => new Promise(() => {}) };
  const asking = harness(silent);
  const waiting = asking.tasks.ask("dark mode and hide the dock") as string;
  asking.tasks.stop(waiting);
  expect(asking.tasks.get(waiting)?.phase).toBe("stopped");

  let release: () => void = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const { tasks, ran, kept } = harness(fakeAnswerer([darkAndDock]), { gate });
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  const run = tasks.run(id);
  await settle();
  // The first step is running; Stop comes meanwhile.
  tasks.stop(id);
  release();
  await run;
  expect(ran.map((each) => each.args.name)).toEqual(["dark_mode"]);
  expect(tasks.get(id)?.phase).toBe("stopped");
  expect(tasks.get(id)?.steps.map((step) => step.state.kind)).toEqual(["done", "skipped"]);
  // The history's last word on it is how it ended.
  expect(kept.at(-1)?.steps.map((step) => step.outcome)).toEqual(["done", "skipped"]);
});

test("Undo puts the setting back as the person and marks the history", async () => {
  const { tasks, undone, undos } = harness(fakeAnswerer([darkAndDock]), { settings: { dark_mode: false, dock_autohide: true } });
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  await tasks.run(id);
  // Autohide was on already: nothing to put back.
  expect(tasks.get(id)?.steps[1]?.undo).toBeUndefined();
  const undo = tasks.get(id)?.steps[0]?.undo;
  if (!undo) throw new Error("no undo");
  const outcome = await tasks.undo(`${id}.1`, 0, undo);
  expect(outcome.ok).toBe(true);
  expect(undos).toEqual([{ name: "dark_mode", value: false }]);
  expect(undone).toEqual([[`${id}.1`, 0]]);
  expect(tasks.get(id)?.steps[0]?.undone).toBe(true);
});
