import { expect, test } from "bun:test";
import type { ModelCall } from "../src/agents/ask/answerer.ts";
import { AnswerError } from "../src/agents/ask/answerer.ts";
import { darkAndDock, fakeAnswerer, harness } from "./support/agents-ask-tasks.ts";
import { settle } from "./support/time.ts";

test("no answerer chosen: nothing is asked", () => {
  const { tasks } = harness(null);
  expect(tasks.ask("dark mode and hide the dock")).toBeNull();
  expect(tasks.getSnapshot()).toEqual([]);
});

test("Ask shows a plan; nothing runs until Return", async () => {
  const answerer = fakeAnswerer([darkAndDock]);
  const { tasks, ran } = harness(answerer);
  const id = tasks.ask("dark mode and hide the dock");
  if (!id) throw new Error("no task");
  expect(tasks.get(id)?.phase).toBe("asking");
  await settle();
  const task = tasks.get(id);
  expect(task?.phase).toBe("planned");
  expect(task?.steps.map((step) => step.title)).toEqual(["Turn Dark Mode on", "Hide the Dock automatically"]);
  expect(answerer.turns).toEqual([{ text: "dark mode and hide the dock", results: [] }]);
  expect(ran).toEqual([]);
});

test("Ask with the context chips: the answerer hears them after the words; the task keeps the words alone", async () => {
  const answerer = fakeAnswerer([darkAndDock]);
  const { tasks } = harness(answerer);
  const id = tasks.ask("dark mode and hide the dock", "The window in front is Notes (window w2).") as string;
  await settle();
  expect(tasks.get(id)?.request).toBe("dark mode and hide the dock");
  expect(answerer.turns[0]?.text).toBe("dark mode and hide the dock\n\nThe window in front is Notes (window w2).");
});

test("Return runs exactly those calls, in order, as the answerer's, in its task; a setting keeps its Undo", async () => {
  const { tasks, ran, kept } = harness(fakeAnswerer([darkAndDock]), { settings: { dark_mode: false, dock_autohide: false } });
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  await tasks.run(id);
  expect(ran.map((each) => each.args)).toEqual([
    { name: "dark_mode", value: true },
    { name: "dock_autohide", value: true },
  ]);
  expect(ran.every((each) => each.address === "dashi://tool/set-setting" && each.by.agent === "Claude" && each.by.task === id)).toBe(true);
  const task = tasks.get(id);
  expect(task?.phase).toBe("done");
  expect(task?.steps.map((step) => step.state.kind)).toEqual(["done", "done"]);
  expect(task?.steps[0]?.undo).toEqual({ address: "dashi://tool/set-setting", args: { name: "dark_mode", value: false }, title: "Turn Dark Mode off" });
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ task: `${id}.1`, agent: "Claude", request: "dark mode and hide the dock" });
  expect(kept[0]?.steps.map((step) => step.outcome)).toEqual(["done", "done"]);
});

test("a Return the compositor can't confirm as the person's runs nothing: Not allowed, with Allow once", async () => {
  const { tasks, ran } = harness(fakeAnswerer([darkAndDock]), { person: [false, true] });
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  await tasks.run(id);
  expect(ran).toEqual([]);
  expect(tasks.get(id)?.steps.map((step) => step.state.kind)).toEqual(["not-allowed", "not-allowed"]);
  // Allow once on the first step: it alone runs, on the person's own press.
  await tasks.allowOnce(id, 0);
  expect(ran.map((each) => each.args.name)).toEqual(["dark_mode"]);
  expect(tasks.get(id)?.steps.map((step) => step.state.kind)).toEqual(["done", "not-allowed"]);
  expect(tasks.get(id)?.phase).toBe("planned");
});

test("a step whose own sheet was answered no is Not allowed; a failure says why", async () => {
  const calls = [
    { id: "a", name: "trash_file", input: { path: "/home/alexk/old.txt" } },
    { id: "b", name: "lock_screen", input: {} },
  ];
  const { tasks } = harness(fakeAnswerer([calls]), {
    outcomes: [
      { ok: false, error: "Cancelled." },
      { ok: false, error: "The screen is locked." },
    ],
  });
  const id = tasks.ask("trash old.txt and lock") as string;
  await settle();
  await tasks.run(id);
  expect(tasks.get(id)?.steps.map((step) => step.state)).toEqual([{ kind: "not-allowed" }, { kind: "failed", error: "The screen is locked." }]);
});

test("an argument that doesn't fit is shown and never run", async () => {
  const { tasks, ran } = harness(fakeAnswerer([[{ id: "x", name: "set_setting", input: { name: "dark_mode", value: "yes" } }, darkAndDock[0] as ModelCall]]));
  const id = tasks.ask("dark please") as string;
  await settle();
  await tasks.run(id);
  expect(ran.map((each) => each.args)).toEqual([{ name: "dark_mode", value: true }]);
  expect(tasks.get(id)?.steps[0]?.state.kind).toBe("invalid");
});

test("a follow-up tells the model how each call went, then plans again", async () => {
  const answerer = fakeAnswerer([darkAndDock, [{ id: "t3", name: "lock_screen", input: {} }]]);
  const { tasks } = harness(answerer);
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  await tasks.run(id);
  expect(tasks.followUp(id, "and lock the screen")).toBe(true);
  await settle();
  expect(answerer.turns[1]).toEqual({
    text: "and lock the screen",
    results: [
      { id: "t1", text: "Done.", error: false },
      { id: "t2", text: "Done.", error: false },
    ],
  });
  expect(answerer.histories[1]).toEqual(["dark mode and hide the dock"]);
  expect(tasks.get(id)?.steps.map((step) => step.title)).toEqual(["Lock the screen"]);
  expect(tasks.entryOf(id)).toBe(`${id}.2`);
});

test("no answer: Retry asks again; a missing key says where it goes", async () => {
  const answerer = fakeAnswerer([new AnswerError("no-answer", "Claude didn't answer."), darkAndDock]);
  const { tasks } = harness(answerer);
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  expect(tasks.get(id)?.phase).toBe("failed");
  expect(tasks.get(id)?.failure).toEqual({ kind: "no-answer", text: "Claude didn't answer." });
  tasks.retry(id);
  await settle();
  expect(tasks.get(id)?.phase).toBe("planned");
  expect(answerer.turns).toHaveLength(2);
});
