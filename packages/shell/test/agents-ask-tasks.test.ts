import { expect, test } from "bun:test";
import type { ActionDef, Args, Outcome } from "../src/actions/types.ts";
import { ANSWERERS, AnswerError, type Answerer, type ModelCall, type Turn } from "../src/agents/ask/answerer.ts";
import { readHistory, type TaskRecord } from "../src/agents/ask/history.ts";
import { nowItems, TurnWatch } from "../src/agents/ask/now.ts";
import { AskTasks, FAILED_STAYS_MS, type TaskDeps } from "../src/agents/ask/tasks.ts";
import { TOOL_ACTIONS } from "../src/agents/tools/index.ts";

const settle = () => new Promise((done) => setTimeout(done, 5));

/** An answerer that replies with `calls` (or fails), and remembers each turn it was given. */
function fakeAnswerer(replies: Array<ModelCall[] | AnswerError>): Answerer & { turns: Turn[]; histories: unknown[][] } {
  const turns: Turn[] = [];
  const histories: unknown[][] = [];
  return {
    info: ANSWERERS.claude,
    turns,
    histories,
    async turn(history, turn) {
      turns.push(turn);
      histories.push([...history]);
      const reply = replies.shift() ?? [];
      if (reply instanceof AnswerError) throw reply;
      return { reply: { text: reply.length === 0 ? "I can't do that here." : "", calls: reply }, history: [...history, turn.text] };
    },
  };
}

function harness(
  answerer: Answerer | null,
  options: { person?: boolean[]; outcomes?: Outcome[]; settings?: Record<string, unknown>; gate?: Promise<void>; timers?: TaskDeps["timers"] } = {},
) {
  const ran: Array<{ address: string; args: Args; by: { agent: string; task: string } }> = [];
  const kept: TaskRecord[] = [];
  const undone: Array<[string, number]> = [];
  const undos: Args[] = [];
  const person = options.person ?? [true];
  const deps: TaskDeps = {
    answerer: () => answerer,
    actions: () => TOOL_ACTIONS,
    run: async (action: ActionDef, args, by) => {
      ran.push({ address: action.address, args, by });
      await options.gate;
      return options.outcomes?.shift() ?? { ok: true, text: "Done." };
    },
    personPressed: async () => person.shift() ?? true,
    settingNow: (name) => (options.settings?.[name] as boolean | undefined) ?? null,
    undo: async (undo) => {
      undos.push(undo.args);
      return { ok: true, text: "Put back." };
    },
    history: { add: (record) => kept.push(record), undone: (entry, step) => undone.push([entry, step]) },
    now: () => 1_000_000,
    timers: options.timers ?? { set: () => null, clear() {} },
  };
  return { tasks: new AskTasks(deps), ran, kept, undone, undos };
}

const darkAndDock = [
  { id: "t1", name: "set_setting", input: { name: "dark_mode", value: true } },
  { id: "t2", name: "set_setting", input: { name: "dock_autohide", value: true } },
];

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

test("a failed ask leaves Now a while after (or once the launcher closes), and stays in the history", async () => {
  const pending: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const timers = {
    set: (run: () => void, ms: number) => {
      const timer = { run, ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear: (handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const fire = () => {
    for (const timer of pending.splice(0)) if (!timer.cleared) timer.run();
  };
  const answerer = fakeAnswerer([
    new AnswerError("no-answer", "Claude didn't answer."),
    new AnswerError("no-answer", "Claude didn't answer."),
    darkAndDock,
    new AnswerError("no-answer", "Claude didn't answer."),
  ]);
  const { tasks, kept } = harness(answerer, { timers });
  const now = () => nowItems({ turns: [], tasks: tasks.getSnapshot(), agents: [] }).map((item) => item.kind === "task" && item.status);
  const id = tasks.ask("dark mode and hide the dock") as string;
  await settle();
  expect(now()).toEqual(["dark mode and hide the dock · didn't answer"]);
  expect(pending.map((timer) => timer.ms)).toEqual([FAILED_STAYS_MS]);
  // Kept as the plan it would have been, saying why there was none.
  expect(kept).toEqual([{ task: `${id}.1`, time: 1000, agent: "Claude", request: "dark mode and hide the dock", steps: [], failure: "Claude didn't answer." }]);
  fire();
  expect(now()).toEqual([]);
  // Its plan is still there to Retry; a Retry is back in Now while it asks.
  expect(tasks.get(id)).toMatchObject({ phase: "failed", leftNow: true });
  tasks.retry(id);
  expect(now()).toEqual(["dark mode and hide the dock · planning"]);
  await settle();
  expect(now()).toEqual(["dark mode and hide the dock · didn't answer"]);
  // The launcher closes: it goes at once, and its timer with it.
  tasks.letFailedGo();
  expect(now()).toEqual([]);
  expect(pending.every((timer) => timer.cleared)).toBe(true);
  tasks.retry(id);
  await settle();
  expect(tasks.get(id)?.phase).toBe("planned");
  expect(tasks.get(id)?.leftNow).toBeUndefined();
  // A failure after a plan stays in Now again, and a failed line never stands for a plan that ran.
  tasks.followUp(id, "and mute");
  await settle();
  expect(now()).toEqual(["and mute · didn't answer"]);
});

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

test("nothing to do: the model's words, and the task leaves Now", async () => {
  const { tasks } = harness(fakeAnswerer([[]]));
  const id = tasks.ask("paint my house") as string;
  await settle();
  expect(tasks.get(id)).toMatchObject({ phase: "done", said: "I can't do that here.", steps: [] });
  expect(nowItems({ turns: [], tasks: tasks.getSnapshot(), agents: [] })).toEqual([]);
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

test("Now: a Your turn first, then the launcher's tasks, then agents (not twice for one handing over)", async () => {
  const watch = new TurnWatch();
  let done: (value: boolean) => void = () => {};
  const turn = { agent: 2, who: { name: "claude", detail: "", claims: null, remote: false }, reason: "enter the code from your bank", window: 7 };
  void watch.track(turn, new Promise<boolean>((resolve) => (done = resolve)));
  const { tasks } = harness(fakeAnswerer([darkAndDock]));
  tasks.ask("dark mode and hide the dock");
  await settle();
  const items = nowItems({
    turns: watch.getSnapshot(),
    tasks: tasks.getSnapshot(),
    agents: [
      { id: 2, name: "claude", status: "Waiting for you", scopes: [] },
      { id: 3, name: "codex", status: "Sorting Downloads", scopes: [] },
    ],
  });
  expect(items).toEqual([
    { kind: "turn", agent: 2, name: "claude", reason: "enter the code from your bank", window: 7 },
    { kind: "task", id: expect.any(String), name: "Claude", status: "dark mode and hide the dock · 2 steps ready", phase: "planned" },
    { kind: "agent", id: 3, name: "codex", status: "Sorting Downloads" },
  ]);
  done(true);
  await settle();
  expect(watch.getSnapshot()).toEqual([]);
});
